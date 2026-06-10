import { Component, ChangeDetectionStrategy, DestroyRef, inject, effect, untracked, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of, catchError, timeout } from 'rxjs';
import { MsalService } from '@azure/msal-angular';
import { ApiService } from '@core/services/api.service';
import { AppStateService, BuildListState } from '@core/services/app-state.service';
import { DataPreloadService } from '@core/services/data-preload.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { NlqFilterService, NlqFilterContext } from '@core/services/nlq-filter.service';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain, SavedList, ProducerDetails, RefinementFilters, QueryLibraryItem } from '@models';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, CardDescriptionComponent } from '@shared/components/card/card.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { BadgeComponent } from '@shared/components/badge/badge.component';
import { DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent } from '@shared/components/dialog/dialog.component';
import { InputComponent } from '@shared/components/input/input.component';
import { CustomerMapComponent } from '@features/customers/components/map/customer-map.component';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';
import { HighlightPipe } from '@shared/pipes/highlight.pipe';
import { expandCommodityAliases } from '@shared/utils/commodity-aliases';
import { isContractUnconfirmed, isContractOverdueWithUnshippedBu, buildConversionMap } from '@shared/utils/contract-status';
import { matchTicketViewModeFilters } from '@shared/utils/ticket-view-filters';
import { buildLinkedProducerComponents } from '@shared/utils/linked-producers';

@Component({
  selector: 'app-build-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardComponent,
    CardContentComponent,
    CardHeaderComponent,
    CardTitleComponent,
    CardDescriptionComponent,
    ButtonComponent,
    BadgeComponent,
    DialogComponent,
    DialogHeaderComponent,
    DialogTitleComponent,
    DialogDescriptionComponent,
    DialogContentComponent,
    DialogFooterComponent,
    InputComponent,
    CustomerMapComponent,
    TradeUnitSelectorComponent,
    HighlightPipe
  ],
  templateUrl: './build-list.component.html',
  styles: [`input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }`],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BuildListComponent {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly dataPreloadService = inject(DataPreloadService);
  private readonly toastService = inject(ToastService);
  private readonly nlqFilterService = inject(NlqFilterService);
  private readonly msalService = inject(MsalService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly usageTracking = inject(UsageTrackingService);

  // Trade units captured at init — used to detect changes on destroy
  private _initTradeUnits: string[] = [];
  private _initialized = false;
  private _ticketsReady = signal(false);
  // Mirrors _ticketsReady for contracts: false until a FRESH _loadFresh confirms contracts.
  // Deliberately NOT set from the cache-restore path — cached contracts may be empty/stale
  // (e.g. arriving from the home page before contracts finished, or a prior TU). Contract-aware
  // queries wait on this so "All producers with contracts" can't filter against a not-yet-loaded
  // contract set and falsely return "no producers matched".
  private _contractsReady = signal(false);
  private _loadRequestId = 0;
  private _queryGenId = 0;
  private _pendingIncludedIds: number[] = [];
  // True once the forkJoin (or cache restore) has populated all core data signals.
  // Guards processQuery() and example chips from running against partial/empty data.
  readonly coreDataLoaded = signal(false);
  // All trade units the user can access (union of all groups from Entitlements DB)
  private _allUserTradeUnits = signal<string[]>([]);

  // Re-trigger a staged query when needed data arrives from the background refresh.
  // When processQuery() detects missing data, it keeps isProcessing=true and returns.
  // This effect watches the data signals and re-triggers processQuery when they update.
  private _dataReadyEffect = effect(() => {
    this.notes();
    this.storedGrain();
    this._ticketsReady();
    this._contractsReady();
    if (this.queryText().trim() && this.isProcessing() && this.coreDataLoaded()) {
      untracked(() => {
        // Re-check if the needed data is now available
        const q = this.queryText();
        const ticketsOk = !this.nlqFilterService.queryInvolvesTickets(q) || this._ticketsReady();
        const contractsOk = !this.nlqFilterService.queryInvolvesContracts(q) || this._contractsReady();
        const storageOk = !this.nlqFilterService.queryInvolvesStorage(q) || this.storedGrain().length > 0;
        const notesOk = !this.nlqFilterService.queryInvolvesContact(q) || this.notes().length > 0;
        if (ticketsOk && contractsOk && storageOk && notesOk) {
          this.waitingForTickets.set(false);
          this._applyNlqFilter();
          this.isProcessing.set(false);
        }
      });
    }
  });

  // Pick up tickets that arrived via home's bulk fetch AFTER our own getTickets timed
  // out with []. Without this, a Build a List ticket query that ran during the empty
  // window would be stuck on "0 producers" even though the real tickets are now in
  // appState. If appState has more tickets than our local copy, hydrate and re-run
  // any already-completed ticket-dependent query so the result picks up the new data.
  private _appStateTicketsEffect = effect(() => {
    const appTickets = this.appState.tickets();
    if (appTickets.length > this.tickets().length) {
      untracked(() => {
        this.tickets.set(appTickets);
        this._ticketsReady.set(true);
        const q = this.queryText().trim();
        if (q && this.hasGenerated() && this.nlqFilterService.queryInvolvesTickets(q)) {
          this._applyNlqFilter();
        }
      });
    }
  });

  private _tuEffect = effect(() => {
    this.appState.selectedTradeUnits();
    if (!this._initialized) {
      this._initialized = true;
      return;
    }
    untracked(() => {
      this.clearQuery();
      const tus = this.appState.selectedTradeUnits();
      this._initTradeUnits = tus.slice(); // Update so destroy handler saves state correctly
      if (tus.length > 0) {
        this._loadFresh(true); // TU changed — clear stale data
      }
    });
  });

  customers = signal<Customer[]>([]);
  contracts = signal<Contract[]>([]);
  tickets = signal<Ticket[]>([]);
  plantingIntentions = signal<PlantingIntention[]>([]);
  notes = signal<Note[]>([]);
  storedGrain = signal<StoredGrain[]>([]);
  savedLists = signal<SavedList[]>([]);

  /** Returns the effective trade units — explicit selection if any, otherwise all user-accessible TUs. */
  readonly effectiveTradeUnits = computed(() => {
    const explicit = this.appState.selectedTradeUnits();
    return explicit.length > 0 ? explicit : this._allUserTradeUnits();
  });


  readonly hasTradeUnits = computed(() => this.effectiveTradeUnits().length > 0);
  /** "All Producers" mode is a customer-home search affordance with no trade-unit scope.
   *  Build a List is inherently per-trade-unit, so in this mode we show a gate prompting the
   *  user to pick a trade group/unit instead of the (unscoped) query library. */
  readonly allProducersMode = computed(() => this.appState.allProducersMode());

  /** True when the active query depends on contracts AND the contracts fetch failed on the last
   *  load. The results area uses this to show a "couldn't load contract data — retry" panel
   *  instead of a misleading "no producers found", since the filter would have run against an
   *  empty contracts array. */
  readonly contractsUnavailableForQuery = computed(() =>
    this.contractsLoadFailed() && this.nlqFilterService.queryInvolvesContracts(this.queryText()));

  /** Only show saved lists whose trade units exactly match the currently selected TUs. */
  readonly visibleSavedLists = computed(() => {
    const selectedTus = this.appState.selectedTradeUnits();
    if (selectedTus.length === 0) return [];
    const selectedSet = new Set(selectedTus);
    return this.savedLists().filter(list => {
      if (!list.tradeUnits) return false;
      const listTus = list.tradeUnits.split(',').map(t => t.trim()).filter(Boolean);
      if (listTus.length !== selectedSet.size) return false;
      return listTus.every(tu => selectedSet.has(tu));
    });
  });

  readonly activeRefinementCount = computed(() => {
    const r = this.appliedRefinements();
    return [
      r.noActiveContracts, r.hasUnsignedContracts, r.downHarvestPace,
      r.hasUnpricedContracts, r.hasOverdueContracts, r.noContractsAtAll,
      r.contractQuantityOver != null && r.contractQuantityOver > 0,
      r.contractsExpiringThisMonth, r.multipleCommoditiesContracted,
      r.neverContacted, r.notContactedDays != null && r.notContactedDays > 0,
      r.notesInLastDays != null && r.notesInLastDays > 0,
      r.contactedOnlyOnce, r.contactedMoreThan5,
      r.contactedByMeOnly, r.contactedBySomeoneElse,
      r.hasPinnedNotes, r.noteKeyword?.trim(),
      r.acresOver != null && r.acresOver > 0, r.hasBinCapacity, r.noBinCapacity,
      r.hasPrimaryContact, r.noPrimaryContact, r.hasEmail, r.hasPhone, r.hasLinkedProducers, r.notEsignEnrolled,
      r.hasActiveContracts, r.hasDeliveriesThisYear, r.hasPlantingIntentions, r.hasGrainInStorage,
      r.ticketQuantityOver != null && r.ticketQuantityOver > 0,
      r.ticketsInLastDays != null && r.ticketsInLastDays > 0,
      r.avgMoistureOver != null, r.avgMoistureUnder != null,
      r.avgTestWeightOver != null, r.avgTestWeightUnder != null,
      r.avgProteinOver != null, r.avgProteinUnder != null,
      r.storageDaysOver != null && r.storageDaysOver > 0,
      r.storageQuantityOver != null && r.storageQuantityOver > 0,
      r.storageReceivableOver != null && r.storageReceivableOver > 0,
      r.plantingYear != null, r.irrigatedOnly, r.drylandOnly, r.doubleCropOnly,
      r.plantingAcresOver != null && r.plantingAcresOver > 0,
      r.crops && r.crops.length > 0, r.states && r.states.length > 0
    ].filter(Boolean).length;
  });

  /** Matches a commodity string against selected crop filters (with aliases). */
  private _matchesCropFilter(value: string, selectedCrops: Set<string>): boolean {
    if (selectedCrops.size === 0) return true; // no crop filter = match all
    const v = value.trim().toLowerCase();
    return [...selectedCrops].some(crop => v.includes(crop) || crop.includes(v));
  }


  readonly displayedCustomers = computed(() => {
    let list = this.filteredCustomers();
    const r = this.appliedRefinements();
    const contractMap = this._openContractsByCustomer(); // Open contracts only for refinements

    // Build expanded crop set for contextual filtering (used by ticket/contract/storage filters)
    const selectedCrops = new Set<string>();
    if (r.crops && r.crops.length > 0) {
      for (const crop of r.crops) {
        for (const alias of expandCommodityAliases(crop)) selectedCrops.add(alias);
      }
    }
    const contactMap = this.lastContactByCustomer();

    // Helper: get contracts for a customer, optionally scoped to selected crops
    const getContracts = (c: Customer): Contract[] => {
      let contracts = contractMap.get(c.scoularId!) || [];
      if (selectedCrops.size > 0) {
        contracts = contracts.filter(ct =>
          this._matchesCropFilter(ct.commodityCode || '', selectedCrops) ||
          this._matchesCropFilter(ct.commodityDescription || '', selectedCrops) ||
          this._matchesCropFilter(ct.commodityGroup || '', selectedCrops)
        );
      }
      return contracts;
    };

    // Contract status filters
    if (r.noActiveContracts) {
      list = list.filter(c => !getContracts(c).some(ct => ct.status === 'Active' || ct.status === 'Pending' || ct.status === 'Overdue'));
    }
    if (r.hasUnsignedContracts) {
      // "Has unconfirmed contracts" — matches Insights UnconfirmedContracts rule:
      // customerConfirmStatus !== 'confirmed' AND status not Fulfilled/Cancelled.
      list = list.filter(c => getContracts(c).some(ct => isContractUnconfirmed(ct)));
    }
    if (r.downHarvestPace) {
      list = list.filter(c => this._getCustomerPacingDirection(c) === 'down');
    }
    if (r.hasUnpricedContracts) {
      list = list.filter(c => getContracts(c).some(ct => ct.priceTypeCode === 'U' || ct.priceTypeCode === 'D'));
    }
    if (r.hasOverdueContracts) {
      // "Has overdue bu contracts" — matches Insights UnshippedBushels rule. Reads
      // contract.openBalanceQuantity via the shared delivery util; no ticket dependency.
      const today = new Date();
      list = list.filter(c => getContracts(c).some(ct => isContractOverdueWithUnshippedBu(ct, today)));
    }
    if (r.noContractsAtAll) {
      list = list.filter(c => getContracts(c).length === 0);
    }
    // Contract detail filters
    if (r.contractQuantityOver != null && r.contractQuantityOver > 0) {
      list = list.filter(c => {
        const totalQty = getContracts(c).reduce((sum, ct) => sum + (ct.quantity ?? 0), 0);
        return totalQty > r.contractQuantityOver!;
      });
    }
    if (r.contractsExpiringThisMonth) {
      const now = new Date();
      const thisMonth = now.getMonth();
      const thisYear = now.getFullYear();
      list = list.filter(c => getContracts(c).some(ct => {
        if (!ct.deliveryEnd) return false;
        const end = new Date(ct.deliveryEnd);
        return end.getMonth() === thisMonth && end.getFullYear() === thisYear;
      }));
    }
    if (r.multipleCommoditiesContracted) {
      list = list.filter(c => {
        const commodities = new Set(getContracts(c).map(ct => ct.commodityCode || ct.commodityDescription || '').filter(Boolean));
        return commodities.size >= 2;
      });
    }
    if (r.neverContacted) {
      list = list.filter(c => !contactMap.has(c.id));
    } else if (r.notContactedDays != null && r.notContactedDays > 0) {
      list = list.filter(c => {
        const info = contactMap.get(c.id);
        if (!info) return true; // never contacted → include
        return info.daysAgo >= r.notContactedDays!;
      });
    }
    if (r.notesInLastDays != null && r.notesInLastDays > 0) {
      list = list.filter(c => {
        const info = contactMap.get(c.id);
        if (!info) return false; // no notes → exclude (positive filter)
        return info.daysAgo <= r.notesInLastDays!;
      });
    }

    // Note-aggregating filters share a per-customer "code network" (own + outgoing-linked + incoming-linked).
    // Linked-producer notes count toward the customer's totals so contact frequency, author, pinned, and
    // keyword filters all respect the same linked-as-one-entity model used elsewhere on the page.
    const wantsAggregatedNotes = r.contactedOnlyOnce || r.contactedMoreThan5
      || r.contactedByMeOnly || r.contactedBySomeoneElse
      || r.hasPinnedNotes || !!r.noteKeyword?.trim();
    let codesByCustomerId: Map<number, Set<string>> | null = null;
    if (wantsAggregatedNotes) {
      const components = this.linkedProducerComponents();
      codesByCustomerId = new Map<number, Set<string>>();
      for (const c of this.customers()) {
        if (c.scoularId) {
          const comp = components.get(c.scoularId);
          codesByCustomerId.set(c.id, comp ? new Set(comp) : new Set([c.scoularId]));
        } else {
          codesByCustomerId.set(c.id, new Set());
        }
      }
    }

    // Contact frequency — note count across the customer's network (own + linked).
    if (r.contactedOnlyOnce || r.contactedMoreThan5) {
      const countByCode = new Map<string, number>();
      for (const n of this.notes()) {
        if (!n.customerCode) continue;
        countByCode.set(n.customerCode, (countByCode.get(n.customerCode) || 0) + 1);
      }
      const totalFor = (c: Customer): number => {
        let total = 0;
        const codes = codesByCustomerId!.get(c.id);
        if (codes) for (const code of codes) total += countByCode.get(code) || 0;
        return total;
      };
      if (r.contactedOnlyOnce) list = list.filter(c => totalFor(c) === 1);
      if (r.contactedMoreThan5) list = list.filter(c => totalFor(c) > 5);
    }

    // Contact author — aggregated across the customer's network.
    if (r.contactedByMeOnly || r.contactedBySomeoneElse) {
      const account = this.msalService.instance.getActiveAccount()
        ?? this.msalService.instance.getAllAccounts()[0];
      const myName = (account?.name ?? '').trim().toLowerCase();
      const myUsername = (account?.username ?? '').trim().toLowerCase();
      // Empty identity claims → can't reliably attribute notes; treat as "no notes are mine".
      // This avoids the substring bug where ''.includes('') === true would mark every note as mine.
      const haveIdentity = !!myName || !!myUsername;
      const isAuthorMe = (rawAuthor: string): boolean => {
        if (!rawAuthor || !haveIdentity) return false;
        if (myUsername && rawAuthor === myUsername) return true;
        if (myName && rawAuthor === myName) return true;
        // Token-bounded match prevents "John" matching "Johnson"; works for "John Doe (jdoe@…)" too.
        const escape = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const tokenMatch = (haystack: string, needle: string): boolean => {
          if (!needle) return false;
          return new RegExp(`(?:^|[^\\w])${escape(needle)}(?:[^\\w]|$)`).test(haystack);
        };
        return tokenMatch(rawAuthor, myUsername) || tokenMatch(rawAuthor, myName);
      };

      const authorshipByCode = new Map<string, { byMe: boolean; byOthers: boolean }>();
      for (const n of this.notes()) {
        if (!n.customerCode) continue;
        const author = (n.createdBy || '').trim().toLowerCase();
        if (!author) continue;
        const entry = authorshipByCode.get(n.customerCode) || { byMe: false, byOthers: false };
        if (isAuthorMe(author)) entry.byMe = true; else entry.byOthers = true;
        authorshipByCode.set(n.customerCode, entry);
      }
      const aggregateFor = (c: Customer): { byMe: boolean; byOthers: boolean } => {
        let byMe = false, byOthers = false;
        const codes = codesByCustomerId!.get(c.id);
        if (codes) for (const code of codes) {
          const e = authorshipByCode.get(code);
          if (!e) continue;
          if (e.byMe) byMe = true;
          if (e.byOthers) byOthers = true;
        }
        return { byMe, byOthers };
      };
      if (r.contactedByMeOnly) {
        list = list.filter(c => { const a = aggregateFor(c); return a.byMe && !a.byOthers; });
      }
      if (r.contactedBySomeoneElse) {
        list = list.filter(c => aggregateFor(c).byOthers);
      }
    }

    // Notes content — pinned + keyword both check the customer's full code network.
    if (r.hasPinnedNotes) {
      const pinnedCodes = new Set<string>();
      for (const n of this.notes()) {
        if (n.isPinned && n.customerCode) pinnedCodes.add(n.customerCode);
      }
      list = list.filter(c => {
        const codes = codesByCustomerId!.get(c.id);
        if (!codes) return false;
        for (const code of codes) if (pinnedCodes.has(code)) return true;
        return false;
      });
    }
    if (r.noteKeyword?.trim()) {
      const kw = r.noteKeyword.trim().toLowerCase();
      const matchingCodes = new Set<string>();
      for (const n of this.notes()) {
        if ((n.content || '').toLowerCase().includes(kw) && n.customerCode) {
          matchingCodes.add(n.customerCode);
        }
      }
      list = list.filter(c => {
        const codes = codesByCustomerId!.get(c.id);
        if (!codes) return false;
        for (const code of codes) if (matchingCodes.has(code)) return true;
        return false;
      });
    }
    // Customer size
    if (r.acresOver != null && r.acresOver > 0) {
      list = list.filter(c => (c.totalAcres ?? 0) > r.acresOver!);
    }
    if (r.hasBinCapacity) {
      list = list.filter(c => (c.binCapacity ?? 0) > 0);
    }
    if (r.noBinCapacity) {
      list = list.filter(c => !c.binCapacity || c.binCapacity === 0);
    }

    // Customer info
    if (r.hasPrimaryContact) {
      list = list.filter(c => !!c.primaryContact?.trim());
    }
    if (r.noPrimaryContact) {
      list = list.filter(c => !c.primaryContact?.trim());
    }
    if (r.hasEmail) {
      list = list.filter(c => !!c.email?.trim() || !!c.supplementalEmail?.trim());
    }
    if (r.hasPhone) {
      list = list.filter(c => !!c.phone?.trim() || !!c.extendedPrimaryPhone?.trim());
    }
    if (r.hasLinkedProducers) {
      list = list.filter(c => (c.linkedProducerIds?.length ?? 0) > 0);
    }
    if (r.notEsignEnrolled) {
      list = list.filter(c => !c.eSignEnabled);
    }

    // Customer activity
    if (r.hasActiveContracts) {
      list = list.filter(c => {
        const contracts = contractMap.get(c.scoularId!) || [];
        return contracts.some(ct => ct.status === 'Active' || ct.status === 'Pending');
      });
    }
    if (r.hasDeliveriesThisYear) {
      const thisYear = new Date().getFullYear();
      const ticketCustomers = new Set<string>(
        this.tickets().filter(t => {
          if (!t.date) return false;
          const d = new Date(t.date);
          return d.getFullYear() === thisYear;
        }).map(t => t.customerCode!).filter(Boolean)
      );
      list = list.filter(c => ticketCustomers.has(c.scoularId!));
    }
    if (r.hasPlantingIntentions) {
      const plantingCustomers = new Set<number>(this.plantingIntentions().map(p => p.customerId));
      list = list.filter(c => plantingCustomers.has(c.id));
    }
    if (r.hasGrainInStorage) {
      const storageCustomers = new Set<number>(this.storedGrain().map(s => s.customerId));
      list = list.filter(c => storageCustomers.has(c.id));
    }

    // Storage filters — scoped to selected crops when active
    const scopedStorage = selectedCrops.size > 0
      ? this.storedGrain().filter(s => s.crop && this._matchesCropFilter(s.crop, selectedCrops))
      : this.storedGrain();
    if (r.storageDaysOver != null && r.storageDaysOver > 0) {
      const minDays = r.storageDaysOver;
      const ids = new Set<number>(
        scopedStorage.filter(s => {
          if (s.storageDays != null && s.storageDays > 0) return s.storageDays >= minDays;
          if (!s.storageStartDate) return false;
          const d = new Date(s.storageStartDate);
          return d.getTime() < (Date.now() - minDays * 86400000);
        }).map(s => s.customerId)
      );
      list = list.filter(c => ids.has(c.id));
    }
    if (r.storageQuantityOver != null && r.storageQuantityOver > 0) {
      const customerTotals = new Map<number, number>();
      for (const s of scopedStorage) {
        customerTotals.set(s.customerId, (customerTotals.get(s.customerId) || 0) + s.quantity);
      }
      list = list.filter(c => (customerTotals.get(c.id) || 0) > r.storageQuantityOver!);
    }
    if (r.storageReceivableOver != null && r.storageReceivableOver > 0) {
      const customerTotals = new Map<number, number>();
      for (const s of scopedStorage) {
        customerTotals.set(s.customerId, (customerTotals.get(s.customerId) || 0) + (s.receivableAmount || 0));
      }
      list = list.filter(c => (customerTotals.get(c.id) || 0) > r.storageReceivableOver!);
    }

    // Ticket filters — pre-build lookup and scope tickets to selected crops
    const hasTicketFilter = r.ticketQuantityOver != null || r.ticketsInLastDays != null ||
      r.avgMoistureOver != null || r.avgMoistureUnder != null ||
      r.avgTestWeightOver != null || r.avgTestWeightUnder != null ||
      r.avgProteinOver != null || r.avgProteinUnder != null;
    if (hasTicketFilter) {
      const codeToId = new Map<string, number>();
      for (const c of this.customers()) {
        if (c.scoularId) codeToId.set(c.scoularId, c.id);
      }
      // Scope tickets to selected crops when a crop filter is active
      const scopedTickets = selectedCrops.size > 0
        ? this.tickets().filter(t => t.productCode && this._matchesCropFilter(t.productCode, selectedCrops))
        : this.tickets();

      if (r.ticketsInLastDays != null && r.ticketsInLastDays > 0) {
        const cutoff = Date.now() - r.ticketsInLastDays * 86400000;
        const recentCustomers = new Set<string>();
        for (const t of scopedTickets) {
          if (!t.customerCode || !t.date) continue;
          if (new Date(t.date).getTime() >= cutoff) recentCustomers.add(t.customerCode);
        }
        list = list.filter(c => recentCustomers.has(c.scoularId!));
      }

      // Net bu + quality avg filters operate in one of two view modes:
      //  'grouped' (default) — match using UNAPPLIED ticket groups (productCode|elevatorCode),
      //                        same grouping the customer Unapplied Tickets tab uses. Any group
      //                        meeting the threshold qualifies the customer.
      //  'single'           — match using individual tickets (applied + unapplied). Any single
      //                        ticket meeting the threshold qualifies the customer.
      // Quality avg filters compute group-level averages in 'grouped' mode; in 'single' mode they
      // become per-ticket value checks (so "Avg moisture over 14" reads as "any ticket > 14").
      const viewMode: 'grouped' | 'single' = this.isAppliedTicketsContext()
        ? 'single'
        : (r.ticketViewMode ?? 'single');
      const hasNetBu = r.ticketQuantityOver != null && r.ticketQuantityOver > 0;
      const hasQualityFilter = r.avgMoistureOver != null || r.avgMoistureUnder != null ||
        r.avgTestWeightOver != null || r.avgTestWeightUnder != null ||
        r.avgProteinOver != null || r.avgProteinUnder != null;

      if (hasNetBu || hasQualityFilter) {
        const conversionMap = buildConversionMap(this.appState.commodityConversions());
        const matchingCustomerIds = matchTicketViewModeFilters(
          scopedTickets, codeToId, conversionMap, viewMode, r
        );
        if (matchingCustomerIds) list = list.filter(c => matchingCustomerIds.has(c.id));
      }
    }

    // Planting filters
    if (r.plantingYear) {
      const year = r.plantingYear;
      const ids = new Set<number>(this.plantingIntentions().filter(p => p.plantingYear === year).map(p => p.customerId));
      list = list.filter(c => ids.has(c.id));
    }
    if (r.irrigatedOnly) {
      const ids = new Set<number>(
        this.plantingIntentions().filter(p => p.type?.toLowerCase().includes('irrigat')).map(p => p.customerId)
      );
      list = list.filter(c => ids.has(c.id));
    }
    if (r.drylandOnly) {
      const ids = new Set<number>(
        this.plantingIntentions().filter(p => p.type?.toLowerCase().includes('dryland') || p.type?.toLowerCase().includes('dry land')).map(p => p.customerId)
      );
      list = list.filter(c => ids.has(c.id));
    }
    if (r.doubleCropOnly) {
      const ids = new Set<number>(
        this.plantingIntentions().filter(p => p.type?.toLowerCase().includes('double crop')).map(p => p.customerId)
      );
      list = list.filter(c => ids.has(c.id));
    }
    if (r.plantingAcresOver != null && r.plantingAcresOver > 0) {
      const customerAcres = new Map<number, number>();
      for (const p of this.plantingIntentions()) {
        customerAcres.set(p.customerId, (customerAcres.get(p.customerId) || 0) + p.acres);
      }
      list = list.filter(c => (customerAcres.get(c.id) || 0) > r.plantingAcresOver!);
    }

    if (selectedCrops.size > 0) {
      // Dimension-aware crop filter: when the prompt is about a specific dimension
      // (storage / tickets / planting / contracts), require the producer to have a
      // crop match in THAT dimension's data — not in their generic c.commodities list.
      // Falls back to c.commodities only when no dimension is in play.
      // Uses effectiveLibraryCategory so saved-list loads (which intentionally leave
      // selectedLibraryQuery null to preserve the Active List context) still resolve
      // the right category via queryText match — without this, the saved-list path
      // silently fell back to c.commodities and produced fewer hits than the fresh
      // prompt run with identical filters.
      const category = this.effectiveLibraryCategory();
      const isStorage = category === 'Storage' || r.hasGrainInStorage
        || r.storageDaysOver != null || r.storageQuantityOver != null || r.storageReceivableOver != null;
      const isTickets = category === 'Tickets' || r.hasDeliveriesThisYear
        || r.ticketQuantityOver != null || r.ticketsInLastDays != null
        || r.avgMoistureOver != null || r.avgMoistureUnder != null
        || r.avgTestWeightOver != null || r.avgTestWeightUnder != null
        || r.avgProteinOver != null || r.avgProteinUnder != null;
      const isPlanting = category === 'Planting' || r.hasPlantingIntentions
        || r.plantingYear != null || r.irrigatedOnly || r.drylandOnly || r.doubleCropOnly
        || (r.plantingAcresOver != null && r.plantingAcresOver > 0);
      const isContracts = category === 'Contracts'
        || r.hasActiveContracts || r.hasUnsignedContracts || r.hasUnpricedContracts
        || r.hasOverdueContracts || r.contractsExpiringThisMonth || r.multipleCommoditiesContracted
        || (r.contractQuantityOver != null && r.contractQuantityOver > 0);

      if (isStorage) {
        const storageByCustomer = new Map<number, StoredGrain[]>();
        for (const s of this.storedGrain()) {
          if (!storageByCustomer.has(s.customerId)) storageByCustomer.set(s.customerId, []);
          storageByCustomer.get(s.customerId)!.push(s);
        }
        list = list.filter(c => (storageByCustomer.get(c.id) ?? []).some(s =>
          !!s.crop && this._matchesCropFilter(s.crop, selectedCrops)
        ));
      } else if (isTickets) {
        const codeToId = new Map<string, number>();
        for (const c of this.customers()) {
          if (c.scoularId) codeToId.set(c.scoularId, c.id);
        }
        const matchingIds = new Set<number>();
        for (const t of this.tickets()) {
          if (!t.customerCode || !t.productCode) continue;
          if (this._matchesCropFilter(t.productCode, selectedCrops)) {
            const cid = codeToId.get(t.customerCode);
            if (cid != null) matchingIds.add(cid);
          }
        }
        list = list.filter(c => matchingIds.has(c.id));
      } else if (isPlanting) {
        const plantingByCustomer = new Map<number, PlantingIntention[]>();
        for (const p of this.plantingIntentions()) {
          if (!plantingByCustomer.has(p.customerId)) plantingByCustomer.set(p.customerId, []);
          plantingByCustomer.get(p.customerId)!.push(p);
        }
        list = list.filter(c => (plantingByCustomer.get(c.id) ?? []).some(p =>
          !!p.crop && this._matchesCropFilter(p.crop, selectedCrops)
        ));
      } else if (isContracts) {
        list = list.filter(c => {
          const cContracts = contractMap.get(c.scoularId!) || [];
          return cContracts.some(ct =>
            this._matchesCropFilter(ct.commodityCode || '', selectedCrops) ||
            this._matchesCropFilter(ct.commodityDescription || '', selectedCrops) ||
            this._matchesCropFilter(ct.commodityGroup || '', selectedCrops)
          );
        });
      } else {
        list = list.filter(c => (c.commodities ?? []).some(crop => selectedCrops.has(crop.trim().toLowerCase())));
      }
    }
    if (r.states && r.states.length > 0) {
      list = list.filter(c => {
        const state = c.extendedStateProvince || c.stateProvince;
        return !!state && r.states!.includes(state);
      });
    }
    // Apply manual member overrides: exclude removed, add included
    const excludedIds = this.manuallyExcludedCustomerIds();
    if (excludedIds.size > 0) {
      list = list.filter(c => !excludedIds.has(c.id));
    }
    const includedCustomers = this.manuallyIncludedCustomers();
    if (includedCustomers.length > 0) {
      const existingIds = new Set(list.map(c => c.id));
      const toAdd = includedCustomers.filter(c => !existingIds.has(c.id) && !excludedIds.has(c.id));
      if (toAdd.length > 0) list = [...list, ...toAdd];
    }

    // Collapse linked-customer groups: when the linked-as-one-entity feature is active,
    // keep ONE peer row per connected component (the lowest-id customer in `list` that
    // belongs to it). All other component members get folded into that representative
    // and surface inside its inline linked-producer panel. Uses the transitive component
    // closure so a chain A→B→C produces a single row with both B and C linked, not two
    // separate rows for "A linked to B" and "B linked to C".
    if (this.linkedFeatureActive()) {
      const components = this.linkedProducerComponents();
      const repIdByComponent = new Map<Set<string>, number>(); // component identity → rep id
      for (const c of list) {
        if (!c.scoularId) continue;
        const comp = components.get(c.scoularId);
        if (!comp || comp.size <= 1) continue;
        const existing = repIdByComponent.get(comp);
        if (existing == null || c.id < existing) repIdByComponent.set(comp, c.id);
      }
      if (repIdByComponent.size > 0) {
        list = list.filter(c => {
          if (!c.scoularId) return true;
          const comp = components.get(c.scoularId);
          if (!comp || comp.size <= 1) return true; // standalone customer — keep
          return repIdByComponent.get(comp) === c.id;
        });
      }
    }

    // Order: when inline notes are showing (Notes / Contacts prompts), sort by the most
    // recent matching note across the producer's connected component — newest contact at
    // the top — so the merchandiser sees the freshest activity first. Alphabetical falls
    // through as the tiebreaker when timestamps match (or when both producers have no
    // notes, common for absence prompts like "never contacted"). For all other prompts,
    // sort alphabetically by name so finding a specific producer doesn't depend on data
    // recency.
    if (this.noteFilterActive()) {
      const notesMap = this.matchingNotesByCustomer();
      const maxTimeFor = (customerId: number): number => {
        const notes = notesMap.get(customerId);
        if (!notes || notes.length === 0) return 0;
        let max = 0;
        for (const n of notes) {
          const t = BuildListComponent.parseNoteTime(n.createdAt);
          if (t > max) max = t;
        }
        return max;
      };
      return [...list].sort((a, b) => {
        const dt = maxTimeFor(b.id) - maxTimeFor(a.id);
        if (dt !== 0) return dt;
        return (a.name || '').localeCompare(b.name || '');
      });
    }
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  });

  readonly availableCrops = computed(() => {
    const crops = new Set<string>();
    for (const c of this.filteredCustomers()) {
      for (const crop of (c.commodities ?? [])) {
        if (crop.trim()) crops.add(crop.trim());
      }
    }
    return [...crops].sort();
  });

  readonly availableStates = computed(() => {
    const states = new Set<string>();
    for (const c of this.filteredCustomers()) {
      const s = c.extendedStateProvince || c.stateProvince;
      if (s) states.add(s);
    }
    const list = [...states].sort();
    return list.length > 1 ? list : [];
  });

  queryText = signal('');
  filteredCustomers = signal<Customer[]>([]);
  showSaveDialog = signal(false);
  activeSavedList = signal<SavedList | null>(null);
  showDeleteDialog = signal(false);
  deleteListId = signal<number | null>(null);
  newListName = signal('');
  isProcessing = signal(false);
  waitingForTickets = signal(false);
  hasGenerated = signal(false);
  showMap = signal(false);
  loading = signal(false);
  loadingSavedLists = signal(false);
  detectedState = signal<string | null>(null);
  queryReturnedNoMatches = signal(false);
  // True when the contracts fetch failed/timed out on the last load. Lets the results area
  // distinguish "couldn't load contract data" from a genuine zero-match — a contract-aware
  // query running against a silently-empty contracts array would otherwise read as "0 producers".
  contractsLoadFailed = signal(false);
  showRefinePanel = signal(false);
  pendingRefinements = signal<RefinementFilters>({});
  appliedRefinements = signal<RefinementFilters>({});
  notContactedDaysInput = signal('');
  matchedPatterns = signal<string[]>([]);
  expandedNoteCount = signal<Map<number, number>>(new Map());
  readonly NOTE_PAGE_SIZE = 5;
  expandedLinkedCustomerIds = signal<Set<number>>(new Set());

  // ── Manage Members ──────────────────────────────────────────────────────
  showManageMembersPanel = signal(false);
  manuallyIncludedCustomers = signal<Customer[]>([]);
  manuallyExcludedCustomerIds = signal<Set<number>>(new Set());
  memberSearchTerm = signal('');
  memberSearchResults = signal<Customer[]>([]);
  memberSearchLoading = signal(false);
  private _memberSearchTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly memberOverrideCount = computed(() =>
    this.manuallyIncludedCustomers().length + this.manuallyExcludedCustomerIds().size
  );

  /** Excluded customers as an array for template iteration. */
  readonly excludedCustomersList = computed(() => {
    const ids = [...this.manuallyExcludedCustomerIds()];
    const customerMap = new Map(this.customers().map(c => [c.id, c]));
    return ids.map(id => customerMap.get(id)).filter((c): c is Customer => !!c);
  });

  // ── Pattern display name map for user-facing feedback ────────────────────
  private readonly _patternDisplayNames: { [key: string]: string } = {
    state_filter: 'State', acres_more: 'Acres (min)', acres_less: 'Acres (max)', acres_between: 'Acres (range)',
    large_farm: 'Large operations', small_farm: 'Small operations', not_contacted: 'Not contacted',
    recently_contacted: 'Recently contacted', storage: 'Has storage', no_storage: 'No storage',
    storage_duration: 'Storage duration', planting: 'Planting', no_planting: 'No planting',
    planting_year: 'Crop year', planting_type: 'Planting type',
    active_contract: 'Active contracts', no_contract: 'No contracts',
    unsigned_contract: 'Unconfirmed contracts', negative_pacing: 'Behind on pacing',
    positive_pacing: 'Ahead on pacing', contract_unconfirmed: 'Unconfirmed contracts',
    contract_confirmed: 'Confirmed contracts', contract_priced: 'Pricing status',
    contract_quantity: 'Contract quantity', contract_value: 'Contract value',
    contract_open_balance: 'Open balance', fulfillment_ratio: 'Fulfillment %',
    commodity_contract: 'Commodity contracts', has_deliveries: 'Has deliveries',
    no_deliveries: 'No deliveries', delivery_commodity: 'Delivery commodity',
    delivery_quantity: 'Delivery quantity', ticket_unapplied: 'Unapplied tickets',
    ticket_unsettled: 'Unsettled tickets', has_phone: 'Has phone', no_phone: 'No phone',
    has_email: 'Has email', no_email: 'No email', commodities_match: 'Commodity match', crop_count: 'Crop count',
    top_n: 'Top N ranking', customer_search: 'Name search', region_filter: 'Region',
    multi_commodity: 'Multiple crops (AND)', multi_commodity_or: 'Multiple crops (OR)',
    cross_contract_no_delivery: 'Contracted, not delivered',
    cross_planting_no_contract: 'Planting, no contracts',
    cross_delivery_no_contract: 'Delivered, no contracts',
    note_contains: 'Notes containing',
  };

  readonly matchedPatternLabels = computed(() =>
    this.matchedPatterns()
      .map(p => this._patternDisplayNames[p] || null)
      .filter((label): label is string => label !== null)
      // Deduplicate labels
      .filter((v, i, a) => a.indexOf(v) === i)
  );

  // ── Pre-indexed computed signals for O(1) lookups ────────────────────────

  /** ALL contracts grouped by ctrmCustomerId — includes prior-year closed contracts for pacing. */
  private readonly _contractsByCustomer = computed(() => {
    const map = new Map<string, Contract[]>();
    for (const c of this.contracts()) {
      if (!c.ctrmCustomerId) continue;
      const arr = map.get(c.ctrmCustomerId);
      if (arr) arr.push(c); else map.set(c.ctrmCustomerId, [c]);
    }
    return map;
  });

  /** Open contracts only — used by refinement filters (no active, unconfirmed, overdue bu, etc.). */
  private readonly _openContractsByCustomer = computed(() => {
    const map = new Map<string, Contract[]>();
    for (const c of this.contracts()) {
      if (!c.ctrmCustomerId || c.closedDate) continue;
      const arr = map.get(c.ctrmCustomerId);
      if (arr) arr.push(c); else map.set(c.ctrmCustomerId, [c]);
    }
    return map;
  });

  /** Most recent note per customer — pre-indexed for O(1) template lookup.
   *  Matches home page logic: indexes notes by customerCode (source ID), resolves
   *  linked producer notes bidirectionally (outgoing + incoming links). */
  readonly lastContactByCustomer = computed(() => {
    const map = new Map<number, { text: string; colorClass: string; daysAgo: number }>();

    // Index notes by customerCode (source customer ID) — same as home page
    const notesByCode = new Map<string, { time: number }>();
    for (const n of this.notes()) {
      if (!n.customerCode) continue;
      const time = BuildListComponent.parseNoteTime(n.createdAt);
      const existing = notesByCode.get(n.customerCode);
      if (!existing || time > existing.time) {
        notesByCode.set(n.customerCode, { time });
      }
    }

    // Walk the full linked-producer connected component for each customer so the
    // "last contacted" date reflects the entire chain (A→B→C). Same closure used
    // everywhere else linked behavior matters, so the "last contacted" badge agrees
    // with the inline note panel.
    const allCustomers = this.customers();
    const components = this.linkedProducerComponents();

    const latestNotes = new Map<number, { time: number }>();
    for (const customer of allCustomers) {
      if (!customer.scoularId) continue;
      const codes = components.get(customer.scoularId) ?? new Set([customer.scoularId]);
      let latestTime = 0;
      for (const code of codes) {
        const entry = notesByCode.get(code);
        if (entry && entry.time > latestTime) latestTime = entry.time;
      }
      if (latestTime > 0) latestNotes.set(customer.id, { time: latestTime });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const [customerId, { time }] of latestNotes) {
      const noteDate = new Date(time);
      noteDate.setHours(0, 0, 0, 0);
      // Math.round (not floor): both endpoints are zeroed to local midnight, so the diff is an
      // integer number of days — except across DST transitions where the day is 23 or 25 hours.
      // round handles those edges; floor would mis-bucket a note from yesterday as "today" on
      // spring-forward day.
      const daysAgo = Math.max(0, Math.round((today.getTime() - noteDate.getTime()) / 86400000));
      let result: { text: string; colorClass: string; daysAgo: number };
      if (daysAgo === 0) result = { text: 'Contacted today', colorClass: 'text-scoular-green', daysAgo };
      else if (daysAgo === 1) result = { text: 'Contacted yesterday', colorClass: 'text-scoular-green', daysAgo };
      else if (daysAgo < 7) result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-scoular-green', daysAgo };
      else if (daysAgo < 30) result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-yellow-500', daysAgo };
      else result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-scoular-red', daysAgo };
      map.set(customerId, result);
    }
    return map;
  });

  // ── Note filters: derive whether a note-focused query/filter is active and surface the matching notes per customer for inline display in the result list. ───────────────
  private static readonly _NLQ_NOTE_VERB = /notes?\s+(?:added|made|entered|written|created|left)/;

  /** Parses a note's createdAt as UTC. The API stores DateTime.UtcNow without a 'Z' suffix,
   *  so a bare ISO string would be interpreted by the browser as local time — for a CST user
   *  that drifts cutoff comparisons by 6 hours and would mis-bucket "today"/"yesterday". */
  private static parseNoteTime(ts: string | Date): number {
    const raw = typeof ts === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts + 'Z' : ts;
    return new Date(raw).getTime();
  }

  /** True when the linked-as-one-entity behavior should apply: dedup, badge,
   *  and the linked-producer expand panel. Notes prompts trigger this (linked
   *  notes are aggregated under the entity), and the dedicated "Producers with
   *  linked records" prompt also triggers it. Other prompts (contracts/tickets/
   *  storage/planting) keep linked producers as their own peer rows since they
   *  have separate data per producer. */
  readonly linkedFeatureActive = computed(() => {
    if (this.noteFilterActive()) return true;
    const q = this.queryText().toLowerCase();
    return /linked\s+(?:producer|record)/.test(q);
  });

  /** Connected components over the linked-producer graph — shared with customer-list and
   *  every consumer in this component (linkedProducerInfoByCustomer, displayedCustomers
   *  collapse, codesByCustomerId, matchingNotesByCustomer, lastContactByCustomer) so chained
   *  links A→B→C are treated as one transitive group everywhere. See shared util for details. */
  readonly linkedProducerComponents = computed<Map<string, Set<string>>>(() => {
    return buildLinkedProducerComponents(this.customers());
  });

  /** True when the result list should render an inline note section per customer.
   *  Every Contacts-category prompt surfaces inline notes — including absence prompts
   *  ("never contacted", "haven't contacted in N days"). The user still wants context
   *  on those producers: even if THEY haven't contacted the producer, a teammate or
   *  prior merchandiser may have, and seeing the most-recent note tells them what was
   *  last discussed. The predicate skips date cutoffs for absence prompts so old notes
   *  aren't accidentally hidden. */
  readonly noteFilterActive = computed(() => {
    const r = this.appliedRefinements();
    if (r.notesInLastDays != null && r.notesInLastDays > 0) return true;
    if (r.noteKeyword?.trim()) return true;
    if (r.hasPinnedNotes) return true;
    if (r.contactedByMeOnly || r.contactedBySomeoneElse) return true;
    if (r.contactedOnlyOnce || r.contactedMoreThan5) return true;
    if (r.neverContacted) return true;
    if (r.notContactedDays != null && r.notContactedDays > 0) return true;

    const q = this.queryText().toLowerCase();
    if (/\b(?:contacted|called|reached\s+out)\b/.test(q)) return true;
    return BuildListComponent._NLQ_NOTE_VERB.test(q)
        || /pinned\s+note/.test(q)
        || /(?:with|has|have)\s+notes?\b/.test(q)
        || /notes?\s+(?:about|mentioning|containing|saying)/.test(q);
  });

  /** Predicate that matches a note against whichever note criteria are active. */
  readonly noteFilterPredicate = computed<(n: Note) => boolean>(() => {
    const r = this.appliedRefinements();
    const q = this.queryText().toLowerCase();
    const hasContactVerb = /\b(?:contacted|called|reached\s+out)\b/.test(q);
    // Absence prompts (never / haven't contacted): show ALL notes for the producer so the
    // user can see prior context regardless of recency. The "N days" in "haven't contacted
    // in 30 days" is a property of the producer match, not a date filter on notes shown.
    const isAbsenceQuery = r.neverContacted
      || (r.notContactedDays != null && r.notContactedDays > 0)
      || /never\s+contacted|haven'?t\s+contacted|not\s+(?:been\s+)?contacted|haven'?t\s+called/.test(q);

    let cutoffMs: number | null = null;
    if (!isAbsenceQuery) {
      if (r.notesInLastDays != null && r.notesInLastDays > 0) {
        cutoffMs = Date.now() - r.notesInLastDays * 86400000;
      } else if (BuildListComponent._NLQ_NOTE_VERB.test(q) || hasContactVerb) {
        // Numeric "in last N days" parsing works for both note-verb and contact-verb queries.
        const numeric = q.match(/(?:notes?\s+(?:added|made|entered|written|created|left)|contacted|called|reach(?:ed)?\s+out)\s*(?:in|within)?\s*(?:the\s+)?(?:last|past)?\s*(\d+)\s*days?/);
        if (numeric) cutoffMs = Date.now() - parseInt(numeric[1], 10) * 86400000;
        else if (q.includes('today')) cutoffMs = Date.now() - 1 * 86400000;
        else if (q.includes('yesterday')) cutoffMs = Date.now() - 2 * 86400000;
        else if (q.includes('this week') || q.includes('last week')) cutoffMs = Date.now() - 7 * 86400000;
        else if (q.includes('this month') || q.includes('last month')) cutoffMs = Date.now() - 30 * 86400000;
      }
    }

    // Keyword extraction: prefer the structured refinement; otherwise pull a quoted or "mentioning X"
    // fragment out of the NLQ query so the inline display matches what the user actually asked for.
    let keyword = r.noteKeyword?.trim().toLowerCase() || null;
    if (!keyword) {
      const quoted = q.match(/notes?\s+(?:about|mentioning|containing|saying|with)\s+["']([^"']+)["']/);
      if (quoted) keyword = quoted[1].trim().toLowerCase();
      else {
        const bare = q.match(/notes?\s+(?:about|mentioning|containing|saying)\s+([\w-]+(?:\s+[\w-]+){0,2})/);
        if (bare) keyword = bare[1].trim().toLowerCase();
      }
    }
    const requirePinned = !!r.hasPinnedNotes || /pinned\s+note/.test(q);

    // Author candidates for "by me" / "by someone else" filters. Same matcher the
    // service uses so saved-list "I contacted" filters work even when notes' CreatedBy
    // arrives as the raw UPN (e.g. "CEgr@scoular.com") instead of a display name.
    const account = this.msalService.instance.getActiveAccount() ?? this.msalService.instance.getAllAccounts()[0];
    const authorCandidates = this.nlqFilterService.buildAuthorCandidates(
      null,
      account?.name ?? '',
      account?.username ?? ''
    );
    // Implicit "by me" when query starts with "I contacted / called / reached out"
    const queryImpliesByMe = /^[^a-z]*(?:producers?\s+)?i\s+(?:contacted|called|reached\s+out)\b/.test(q);
    const requireByMe = r.contactedByMeOnly || queryImpliesByMe;
    const requireByOthers = r.contactedBySomeoneElse;

    return (n: Note) => {
      if (cutoffMs != null) {
        const t = BuildListComponent.parseNoteTime(n.createdAt);
        if (!t || t < cutoffMs) return false;
      }
      if (keyword && !(n.content || '').toLowerCase().includes(keyword)) return false;
      if (requirePinned && !n.isPinned) return false;
      if (requireByMe && !this.nlqFilterService.matchesAuthor(n.createdBy, authorCandidates)) return false;
      if (requireByOthers && this.nlqFilterService.matchesAuthor(n.createdBy, authorCandidates)) return false;
      return true;
    };
  });

  /** Notes matching the active note filter, indexed by source customerCode.
   *  Each note is tagged with `viaName = "{Name} ({Code})"` of the customer it was
   *  placed on — applied uniformly to every note so the origin is always visible. */
  private readonly _matchedNotesByCode = computed(() => {
    const map = new Map<string, Array<Note & { viaName: string }>>();
    if (!this.noteFilterActive()) return map;

    const predicate = this.noteFilterPredicate();
    const customerByCode = new Map<string, Customer>();
    for (const c of this.customers()) {
      if (c.scoularId) customerByCode.set(c.scoularId, c);
    }

    for (const n of this.notes()) {
      if (!n.customerCode || !predicate(n)) continue;
      const owner = customerByCode.get(n.customerCode);
      // Consistent shape: always include the code in trailing parens. Name prepended when known,
      // omitted otherwise. Avoids the previous "Name (Code)" vs bare "Code" visual mismatch.
      const viaName = owner ? `${owner.name} (${owner.scoularId})` : `(${n.customerCode})`;
      const arr = map.get(n.customerCode);
      const tagged = { ...n, viaName };
      if (arr) arr.push(tagged);
      else map.set(n.customerCode, [tagged]);
    }

    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
        const dt = BuildListComponent.parseNoteTime(b.createdAt) - BuildListComponent.parseNoteTime(a.createdAt);
        return dt !== 0 ? dt : (b.id ?? 0) - (a.id ?? 0);
      });
    }
    return map;
  });

  /** Per-customer aggregated matching notes (own + linked + incoming), pinned-first then newest-first.
   *  Every note is tagged with viaName so its origin is always identifiable. */
  readonly matchingNotesByCustomer = computed(() => {
    const map = new Map<number, Array<Note & { viaName: string }>>();
    if (!this.noteFilterActive()) return map;

    const matchesByCode = this._matchedNotesByCode();
    if (matchesByCode.size === 0) return map;
    const customers = this.customers();
    const components = this.linkedProducerComponents();

    for (const customer of customers) {
      const ownCode = customer.scoularId;
      if (!ownCode) continue;
      // Walk the full connected component so chained links (A→B→C) aggregate every member's
      // notes onto the representative row.
      const codes = components.get(ownCode) ?? new Set([ownCode]);

      const out: Array<Note & { viaName: string }> = [];
      const seen = new Set<number>();
      for (const code of codes) {
        const matches = matchesByCode.get(code);
        if (!matches) continue;
        for (const n of matches) {
          if (seen.has(n.id)) continue;
          seen.add(n.id);
          out.push(n);
        }
      }
      if (out.length === 0) continue;
      out.sort((a, b) => {
        if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
        const dt = BuildListComponent.parseNoteTime(b.createdAt) - BuildListComponent.parseNoteTime(a.createdAt);
        return dt !== 0 ? dt : (b.id ?? 0) - (a.id ?? 0);
      });
      map.set(customer.id, out);
    }
    return map;
  });

  /** Matching notes for one customer — own notes only (not aggregated). Used in the linked-producer expand panel. */
  getOwnMatchingNotes(customer: Customer): Array<Note & { viaName: string }> {
    return customer.scoularId ? (this._matchedNotesByCode().get(customer.scoularId) ?? []) : [];
  }

  /** Distinct linked-producer info per customer (bidirectional, excluding self).
   *  Only includes producers whose Customer record is loaded — codes without a match are dropped.
   *  Manually-excluded customers are filtered out so the exclude action affects the linked panel too.
   *  Returns an empty map unless the linked-as-one-entity feature is active (notes prompts or
   *  the "Producers with linked records" prompt) — for other queries each producer is its own row.
   *  `producers` is the actual Customer[] for inline detail rendering. */
  readonly linkedProducerInfoByCustomer = computed(() => {
    const map = new Map<number, { count: number; producers: Customer[] }>();
    if (!this.linkedFeatureActive()) return map;
    const customers = this.customers();
    const excludedIds = this.manuallyExcludedCustomerIds();
    const components = this.linkedProducerComponents();

    const customerByCode = new Map<string, Customer>();
    for (const c of customers) {
      if (c.scoularId) customerByCode.set(c.scoularId, c);
    }

    for (const customer of customers) {
      if (!customer.scoularId) continue;
      const component = components.get(customer.scoularId);
      if (!component || component.size <= 1) continue;
      const producers: Customer[] = [];
      for (const code of component) {
        if (code === customer.scoularId) continue;
        const linked = customerByCode.get(code);
        if (linked && !excludedIds.has(linked.id)) producers.push(linked);
      }
      if (producers.length === 0) continue;
      map.set(customer.id, { count: producers.length, producers });
    }
    return map;
  });

  /** Customer ids that are reachable in the result list — either as their own
   *  peer row or as a linked producer inside a peer row's expanded panel. */
  readonly logicallyInResultsIds = computed(() => {
    const ids = new Set<number>();
    const linkedMap = this.linkedProducerInfoByCustomer();
    for (const c of this.displayedCustomers()) {
      ids.add(c.id);
      const info = linkedMap.get(c.id);
      if (info) for (const linked of info.producers) ids.add(linked.id);
    }
    return ids;
  });

  /** Crops per customer — merged from ProducerDetails, contracts, intentions. */
  readonly cropsByCustomer = computed(() => {
    const map = new Map<number, string[]>();
    const contractMap = this._contractsByCustomer();

    // Pre-index intention crops by customerId — O(intentions) instead of O(customers × intentions)
    const intentionCropsByCustomer = new Map<number, Set<string>>();
    for (const p of this.plantingIntentions()) {
      if (!intentionCropsByCustomer.has(p.customerId)) {
        intentionCropsByCustomer.set(p.customerId, new Set());
      }
      intentionCropsByCustomer.get(p.customerId)!.add(p.crop);
    }

    // Pre-index ticket product codes by customerId
    const ticketCropsByCustomer = new Map<number, Set<string>>();
    for (const t of this.tickets()) {
      if (!t.customerId || !t.productCode) continue;
      if (!ticketCropsByCustomer.has(t.customerId)) {
        ticketCropsByCustomer.set(t.customerId, new Set());
      }
      ticketCropsByCustomer.get(t.customerId)!.add(t.productCode);
    }

    // Pre-index stored grain crops by customerId
    const storedGrainCropsByCustomer = new Map<number, Set<string>>();
    for (const sg of this.storedGrain()) {
      if (!sg.customerId || !sg.crop) continue;
      if (!storedGrainCropsByCustomer.has(sg.customerId)) {
        storedGrainCropsByCustomer.set(sg.customerId, new Set());
      }
      storedGrainCropsByCustomer.get(sg.customerId)!.add(sg.crop);
    }

    for (const customer of this.customers()) {
      const detailCrops = customer.commodities?.length ? [...customer.commodities] : [];
      const contractCrops = customer.scoularId
        ? [...new Set(
            (contractMap.get(customer.scoularId) || [])
              .map(c => c.commodityCode)
              .filter((crop): crop is string => !!crop)
          )]
        : [];
      const intentionCrops = [...(intentionCropsByCustomer.get(customer.id) || [])];
      const ticketCrops = [...(ticketCropsByCustomer.get(customer.id) || [])];
      const storageCrops = [...(storedGrainCropsByCustomer.get(customer.id) || [])];
      // Dedupe by trimmed uppercase value, but keep original casing for display
      const seen = new Set<string>();
      const unique: string[] = [];
      for (const crop of [...detailCrops, ...contractCrops, ...intentionCrops, ...ticketCrops, ...storageCrops]) {
        const key = crop.trim().toUpperCase();
        if (key && !seen.has(key)) { seen.add(key); unique.push(crop.trim()); }
      }
      map.set(customer.id, unique.slice(0, 5));
    }
    return map;
  });

  // ── Query Library ──────────────────────────────────────────────────────
  queryLibrary = signal<QueryLibraryItem[]>([]);
  queryLibraryLoaded = signal(false);
  librarySearchText = signal('');
  selectedCategory = signal<string | null>(null);
  selectedLibraryQuery = signal<QueryLibraryItem | null>(null);
  private _searchLogTimeout: ReturnType<typeof setTimeout> | null = null;

  showRequestForm = signal(false);
  requestQueryText = signal('');

  readonly filteredLibrary = computed(() => {
    const search = this.librarySearchText().toLowerCase().trim();
    const category = this.selectedCategory();
    let items = this.queryLibrary();
    if (category) items = items.filter(q => q.category === category);
    if (search) {
      items = items.filter(q =>
        q.name.toLowerCase().includes(search) ||
        (q.description || '').toLowerCase().includes(search) ||
        (q.tags || '').toLowerCase().includes(search) ||
        q.category.toLowerCase().includes(search) ||
        q.queryText.toLowerCase().includes(search)
      );
    }
    return items;
  });

  readonly libraryCategories = computed(() => {
    const cats = new Set(this.queryLibrary().map(q => q.category));
    const sorted = [...cats].sort();
    // Prepend a 'Saved Lists' pseudo-category so it sits right after "All" (which is rendered
    // separately, before this loop). Always shown — when the user has no lists yet, selecting
    // the tab renders an empty-state hint instead of hiding the entry point entirely.
    sorted.unshift('Saved Lists');
    return sorted;
  });

  /** Saved lists shown in the library — user-owned (API filters by createdBy already), scoped
   *  to the current TU (via visibleSavedLists), and matched against the library search text.
   *  Hidden when a non-'Saved Lists' category is selected. */
  readonly librarySavedLists = computed(() => {
    const cat = this.selectedCategory();
    if (cat && cat !== 'Saved Lists') return [];
    const search = this.librarySearchText().toLowerCase().trim();
    let lists = this.visibleSavedLists();
    if (search) {
      lists = lists.filter(l =>
        l.name.toLowerCase().includes(search) ||
        l.query.toLowerCase().includes(search)
      );
    }
    return lists;
  });

  /** The library category driving refine-panel visibility. Prefers the explicitly selected
   *  library prompt; falls back to the matching library item for the active saved list's
   *  query so loading a saved list surfaces the right refine sections without making the
   *  library prompt the "active query" (which would clobber the saved-list context). */
  readonly effectiveLibraryCategory = computed<string | null>(() => {
    const explicit = this.selectedLibraryQuery()?.category;
    if (explicit) return explicit;
    const active = this.activeSavedList();
    if (!active) return null;
    const qLower = active.query.trim().toLowerCase();
    const matched = this.queryLibrary().find(q => q.queryText.trim().toLowerCase() === qLower);
    return matched?.category ?? null;
  });

  /** True when we have an active saved list whose category we can't resolve yet because the
   *  query library is still loading. Used to suppress the wrong "General" fallback sections
   *  in the refine panel during the brief lag between state restore and library API response. */
  readonly isResolvingSavedListCategory = computed<boolean>(() => {
    return !!this.activeSavedList() && !this.queryLibraryLoaded() && !this.selectedLibraryQuery();
  });

  /** Which refine filter sections are visible based on the effective library category. */
  readonly showContractFilters = computed(() => !this.isResolvingSavedListCategory() && this.effectiveLibraryCategory() === 'Contracts');
  readonly showContactFilters = computed(() => {
    if (this.isResolvingSavedListCategory()) return false;
    const cat = this.effectiveLibraryCategory();
    return cat === 'Contacts' || cat === 'Notes';
  });
  /** Filters that are redundant given the selected query — hide them from the UI.
   *  Reads the explicit library prompt OR the active saved list's query so the same hide
   *  rules apply whether the user just clicked a library prompt or re-opened a saved list. */
  readonly hiddenFilters = computed<Set<string>>(() => {
    const q = (this.selectedLibraryQuery()?.queryText || this.activeSavedList()?.query || '').toLowerCase();
    const hidden = new Set<string>();
    // Contract filters
    if (q.includes('active contract'))      { hidden.add('noActiveContracts'); hidden.add('hasActiveContracts'); }
    if (q.includes('unsigned') || q.includes('unconfirmed')) hidden.add('hasUnsignedContracts');
    if (q.includes('unpriced'))             hidden.add('hasUnpricedContracts');
    if (q.includes('pacing') || q.includes('contract pace')) hidden.add('downHarvestPace');
    if (q.includes('overdue'))              hidden.add('hasOverdueContracts');
    if (q.includes('no deliver'))           hidden.add('hasDeliveriesThisYear');
    if (q.includes('expiring'))             hidden.add('contractsExpiringThisMonth');
    // Contact filters
    if (q.includes('never contacted'))      hidden.add('neverContacted');
    if (/not contacted.*\d+\s*days/.test(q)) hidden.add('notContactedDays');
    if (/notes?\s+(?:added|made|entered|written|created|left).*(?:\d+\s*days?|today|yesterday|this\s+week)/.test(q)) hidden.add('notesInLastDays');
    if (q.includes('i contacted') || q.includes('i have contacted')) { hidden.add('contactedByMeOnly'); hidden.add('neverContacted'); }
    if (q.includes('i have never'))         { hidden.add('contactedByMeOnly'); hidden.add('neverContacted'); }
    if (q.includes('contacted this week'))  hidden.add('neverContacted');
    // Notes
    if (q.includes('with notes'))           { hidden.add('hasPinnedNotes'); hidden.add('neverContacted'); }
    if (q.includes('notes mentioning'))     { hidden.add('noteKeyword'); hidden.add('neverContacted'); }
    // General
    if (q.includes('linked producer'))      hidden.add('hasLinkedProducers');
    if (q.includes('no primary contact'))   { hidden.add('noPrimaryContact'); hidden.add('hasPrimaryContact'); }
    if (q.includes('without esign') || q.includes('not esign')) hidden.add('notEsignEnrolled');
    if (q.includes('largest') || q.includes('by acres')) hidden.add('acresOver');
    if (q.includes('planting'))             hidden.add('hasPlantingIntentions');
    if (/planting.*\d{4}|\d{4}.*planting/.test(q)) hidden.add('plantingYear');
    if (q.includes('irrigat'))              hidden.add('irrigatedOnly');
    if (q.includes('dryland'))              hidden.add('drylandOnly');
    if (q.includes('double crop'))          hidden.add('doubleCropOnly');
    if (q.includes('corn') && q.includes('planting')) hidden.add('plantingCrop');
    if (q.includes('wheat') && q.includes('planting')) hidden.add('plantingCrop');
    if (q.includes('in storage') || q.includes('stored')) hidden.add('hasGrainInStorage');
    if (/stored.*over.*\d+\s*days|storage.*over.*\d+\s*days/.test(q)) hidden.add('storageDaysOver');
    if (q.includes('unapplied') || q.includes('applied ticket')) hidden.add('hasDeliveriesThisYear');
    return hidden;
  });

  readonly showTicketFilters = computed(() => !this.isResolvingSavedListCategory() && this.effectiveLibraryCategory() === 'Tickets');
  /** True when the active prompt is specifically about APPLIED tickets (which aren't grouped
   *  on the customer page, so the "View by AVG" toggle and Avg-prefix labels don't apply).
   *  Used to hide the AVG checkbox and force single-ticket mode for those prompts. */
  readonly isAppliedTicketsContext = computed(() => {
    const explicit = this.selectedLibraryQuery()?.queryText;
    const active = this.activeSavedList();
    const q = (explicit || active?.query || this.queryText() || '').toLowerCase();
    return q.includes('applied ticket') && !q.includes('unapplied');
  });
  /** Effective view mode after honoring the applied-tickets force-single rule. */
  readonly effectiveTicketViewMode = computed<'grouped' | 'single'>(() => {
    if (this.isAppliedTicketsContext()) return 'single';
    return this.pendingRefinements().ticketViewMode ?? 'single';
  });
  readonly showStorageFilters = computed(() => !this.isResolvingSavedListCategory() && this.effectiveLibraryCategory() === 'Storage');
  readonly showPlantingFilters = computed(() => !this.isResolvingSavedListCategory() && this.effectiveLibraryCategory() === 'Planting');
  readonly showGeneralFilters = computed(() => {
    if (this.isResolvingSavedListCategory()) return false;
    const cat = this.effectiveLibraryCategory();
    return !cat || cat === 'General';
  });

  readonly groupedLibrary = computed(() => {
    const items = this.filteredLibrary();
    const map = new Map<string, QueryLibraryItem[]>();
    for (const item of items) {
      const arr = map.get(item.category);
      if (arr) arr.push(item); else map.set(item.category, [item]);
    }
    return [...map.entries()].map(([category, queries]) => ({ category, queries }));
  });


  constructor() {
    this._initTradeUnits = this.appState.selectedTradeUnits().slice();

    // Load saved lists eagerly — they're user-scoped, not TU-dependent
    const cachedSavedLists = this.appState.savedLists();
    if (cachedSavedLists.length > 0) {
      this.savedLists.set(cachedSavedLists);
    } else {
      this.loadingSavedLists.set(true);
      this.apiService.getSavedLists().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (lists) => {
          this.savedLists.set(lists);
          this.appState.setSavedLists(lists);
          this.loadingSavedLists.set(false);
        },
        error: () => { this.loadingSavedLists.set(false); }
      });
    }

    // Load query library — populate the shared appState cache so other pages (home,
    // customer-list) can resolve a saved list's prompt category by queryText match
    // without each page fetching independently.
    const cachedLibrary = this.appState.queryLibrary();
    if (cachedLibrary.length > 0) {
      this.queryLibrary.set(cachedLibrary);
      this.queryLibraryLoaded.set(true);
    } else {
      this.apiService.getQueryLibrary().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (items) => {
          this.queryLibrary.set(items);
          this.appState.queryLibrary.set(items);
          this.queryLibraryLoaded.set(true);
        },
        error: () => { this.queryLibraryLoaded.set(true); this.toastService.error('Failed to load query library'); }
      });
    }

    // Load all user-accessible trade units so the TU selector works without prior home page visit
    this.apiService.getUserTradeUnits().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (groups) => {
        const units = new Set<string>();
        for (const g of groups) {
          g.tradeUnitCodes.forEach(u => units.add(u));
        }
        this._allUserTradeUnits.set([...units].sort());
      }
    });

    // Try to restore from cache first, otherwise load fresh
    this._initLoad();

    // Collapse all expanded note rows whenever the filter inputs change. The
    // matching-note set has changed, so previously expanded customers may not
    // even be in the list anymore.
    effect(() => {
      this.appliedRefinements();
      this.queryText();
      untracked(() => this.expandedNoteCount.set(new Map()));
    });

    this.destroyRef.onDestroy(() => {
      // If trade units changed while this component was alive, discard state entirely
      // so re-mounting shows a blank query for the new selection.
      const currentTus = this.appState.selectedTradeUnits();
      const tradeUnitsChanged = currentTus.length !== this._initTradeUnits.length ||
        currentTus.some(tu => !this._initTradeUnits.includes(tu));

      if (tradeUnitsChanged) {
        this.appState.clearBuildListState();
      } else {
        this.appState.setBuildListState({
          queryText: this.queryText(),
          filteredCustomerIds: this.filteredCustomers().map(c => c.id),
          hasGenerated: this.hasGenerated(),
          showMap: this.showMap(),
          detectedState: this.detectedState(),
          tradeUnits: this._initTradeUnits,
          appliedRefinements: this.appliedRefinements(),
          notContactedDaysInput: this.notContactedDaysInput(),
          showRefinePanel: this.showRefinePanel(),
          manuallyIncludedCustomerIds: this.manuallyIncludedCustomers().map(c => c.id),
          manuallyExcludedCustomerIds: [...this.manuallyExcludedCustomerIds()],
          showManageMembersPanel: this.showManageMembersPanel(),
          selectedLibraryQuery: this.selectedLibraryQuery(),
          activeSavedList: this.activeSavedList()
        });
      }
    });
  }

  // =========================================================================
  // Data Loading — Two clear paths: _initLoad (restore) and _loadFresh (fetch)
  // =========================================================================

  /** Called once on mount. Restores UI state, shows cached results, then fetches fresh data. */
  private _initLoad(): void {
    // Restore UI state (query text, refinements, etc.) — this is safe, never corrupted
    this._restoreUIState();

    const currentTus = this.appState.selectedTradeUnits();
    const cachedCustomers = this.appState.customers();

    // If appState already has customer data (loaded by home page or a previous visit),
    // use it immediately for fast display, then do a background refresh to fill in
    // any data the preload service hadn't finished (tickets, stored grain, etc.).
    if (currentTus.length > 0 && cachedCustomers.length > 0) {
      this.customers.set(cachedCustomers);
      this.contracts.set(this.appState.contracts());
      this.tickets.set(this.appState.tickets());
      this.plantingIntentions.set(this.appState.plantingIntentions());
      this.notes.set(this.appState.notes());
      this.storedGrain.set(this.appState.storedGrain());
      this.savedLists.set(this.appState.savedLists());
      // Don't set _ticketsReady from cache — ticket data may be stale or from a
      // different TU. The background refresh will set it when fresh tickets arrive.
      // Ticket-dependent queries will wait via the "Loading delivery data..." path,
      // ensuring they always use fresh data.
      if (this.appState.producerDetails().length > 0) {
        this._mergeProducerDetails(this.appState.producerDetails());
      }

      // Restore filtered results if we had a previous query for the same TUs
      const saved = this.appState.buildListState();
      const savedTus = saved?.tradeUnits ?? [];
      const tusMatch = savedTus.length === currentTus.length
        && currentTus.every(tu => savedTus.includes(tu));
      if (tusMatch && saved?.hasGenerated && saved.filteredCustomerIds.length > 0) {
        const idSet = new Set(saved.filteredCustomerIds);
        this.filteredCustomers.set(this.customers().filter(c => idSet.has(c.id)));
      }

      this.loading.set(false);
      this.coreDataLoaded.set(true);
      this._resolvePendingIncludes();

      // Background refresh: the home page preload may not have finished loading all
      // data (tickets, stored grain load as secondary/background). Fetch fresh data
      // without clearing current signals so the UI stays responsive.
      this._loadFresh(false);
    } else if (currentTus.length > 0) {
      // No cached data — fetch fresh from API
      this._loadFresh();
    } else {
      this.loading.set(false);
    }
  }

  /** Fetches all data fresh from the API for the current trade units.
   *  @param clearSignals If true, clears data signals immediately (TU change). If false, keeps them for display (background refresh). */
  private _loadFresh(clearSignals = false): void {
    const requestId = ++this._loadRequestId;
    this._ticketsReady.set(false);
    // Fresh contracts not yet confirmed — contract-aware queries will wait on this until the
    // forkJoin below resolves (covers the cache-restore background-refresh window).
    this._contractsReady.set(false);
    // Reset the contracts-failure flag so a retry / fresh load starts clean.
    this.contractsLoadFailed.set(false);
    // Only reset coreDataLoaded when clearing signals (TU change / initial load).
    // For background refreshes (clearSignals=false with existing data), keep it true
    // so the UI stays interactive while fresh data loads behind the scenes.
    if (clearSignals || this.customers().length === 0) {
      this.coreDataLoaded.set(false);
    }

    if (clearSignals) {
      // TU changed — clear everything to prevent stale data from previous TU
      this.customers.set([]);
      this.contracts.set([]);
      this.tickets.set([]);
      this.plantingIntentions.set([]);
      this.notes.set([]);
      this.storedGrain.set([]);
      this.loading.set(true);
    } else if (this.customers().length === 0) {
      // No cached data to display — show loading
      this.loading.set(true);
    }

    // Use explicitly selected TUs only
    const tus = this.appState.selectedTradeUnits();
    const tuParam = tus.length > 0 ? tus : undefined;

    // Fetch core data (everything except tickets — those are slow and load in background)
    forkJoin({
      customers: this.apiService.getCustomers(tuParam).pipe(catchError(() => of([] as Customer[]))),
      contracts: this.apiService.getContracts(tuParam).pipe(catchError(() => { this.contractsLoadFailed.set(true); return of([] as Contract[]); })),
      plantingIntentions: this.apiService.getPlantingIntentions(tuParam).pipe(catchError(() => of([] as PlantingIntention[]))),
      notes: this.apiService.getNotes().pipe(catchError(() => of([] as Note[]))),
      storedGrain: this.apiService.getStoredGrain(tuParam).pipe(catchError(() => of([] as StoredGrain[]))),
      savedLists: this.apiService.getSavedLists().pipe(catchError(() => of([] as SavedList[]))),
      producerDetails: this.apiService.getAllProducerDetails().pipe(catchError(() => of([] as ProducerDetails[])))
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        // Ignore stale response from a previous TU's load
        if (requestId !== this._loadRequestId) return;

        this.customers.set(data.customers);
        this.contracts.set(data.contracts);
        this.plantingIntentions.set(data.plantingIntentions);
        this.notes.set(data.notes);
        this.storedGrain.set(data.storedGrain);
        this.savedLists.set(data.savedLists);
        // Merge producer details into customer objects, then write to appState
        if (data.producerDetails.length > 0) this.appState.setProducerDetails(data.producerDetails);
        this._mergeProducerDetails(data.producerDetails);
        // Write to appState so other pages and restore path can use it
        this.appState.setCustomers(this.customers());
        this.appState.setContracts(data.contracts);
        this.appState.setPlantingIntentions(data.plantingIntentions);
        this.appState.setNotes(data.notes);
        this.appState.setStoredGrain(data.storedGrain);
        this.appState.setSavedLists(data.savedLists);

        this.loading.set(false);
        this.coreDataLoaded.set(true);
        // Fresh contracts are now in hand (real data, or [] with contractsLoadFailed set on a
        // failed inner fetch) — release any contract-aware query staged in processQuery.
        this._contractsReady.set(true);

        // Re-run active query with fresh data — cached data may have been stale/incomplete
        // (e.g., notes hadn't finished loading on home page before user navigated here).
        // The _dataReadyEffect handles the case where isProcessing is true (query staged
        // before data loaded). This handles the case where a query already ran against
        // stale cache and needs to silently refresh with the now-complete data.
        if (this.queryText().trim() && this.hasGenerated() && !this.isProcessing()) {
          this._applyNlqFilter();
        }
      },
      error: () => {
        if (requestId !== this._loadRequestId) return;
        this.loading.set(false);
        this.coreDataLoaded.set(true); // Mark loaded even on error so UI isn't stuck
        this._contractsReady.set(true); // Don't strand contract-queries waiting forever on error
        this.toastService.error('Failed to load data');
      }
    });

    // Tickets load in background — processQuery waits for them only if the query needs tickets.
    // On timeout / error the inner `catchError` swallows to [], but we DO NOT clobber the
    // global appState.tickets signal with the empty array. Home's separate bulk fetch may
    // still be in flight; overwriting with [] would silently zero out every ticket-dependent
    // view in the app (home customer list, Insights, Activity Summary, contracts-table).
    // Only write through to appState when the response actually carried tickets.
    this.apiService.getTickets(tuParam).pipe(
      timeout(60000),
      catchError(() => of([] as Ticket[])),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(tickets => {
      if (requestId !== this._loadRequestId) return;
      if (tickets.length > 0) {
        this.tickets.set(tickets);
        this.appState.setTickets(tickets);
      } else if (this.appState.tickets().length > 0) {
        // Timeout fired locally but the global signal already has data (e.g. home's
        // bulk landed first). Hydrate local from appState so the build-list filter sees
        // the real tickets instead of [].
        this.tickets.set(this.appState.tickets());
      }
      this._ticketsReady.set(true);
    });
  }

  /** Merge ProducerDetails into customer objects (commodities, bin capacity, etc.). */
  private _mergeProducerDetails(details: ProducerDetails[]): void {
    if (details.length === 0) return;
    const detailsMap = new Map(details.map(d => [d.customerId, d]));
    let changed = false;
    const merged = this.customers().map(customer => {
      const pd = detailsMap.get(customer.id);
      if (pd) {
        changed = true;
        return {
          ...customer,
          totalAcres: pd.totalAcres ?? customer.totalAcres,
          binCapacity: pd.binCapacity ?? customer.binCapacity,
          primaryContact: pd.primaryContact ?? customer.primaryContact,
          commodities: pd.commodities ? pd.commodities.split(',').map(c => c.trim()) : customer.commodities,
          linkedProducerIds: pd.linkedProducerIds ? pd.linkedProducerIds.split(',').filter(Boolean) : customer.linkedProducerIds
        };
      }
      return customer;
    });
    if (changed) {
      this.customers.set([...merged]);
      // cropsByCustomer computed auto-invalidates when customers() changes
    }
  }

  private _restoreUIState(): void {
    const saved = this.appState.buildListState();
    if (!saved) return;

    // If trade units changed since state was saved, clear everything —
    // the user must re-enter and regenerate for the new selection.
    const currentTus = this.appState.selectedTradeUnits();
    const savedTus = saved.tradeUnits ?? [];
    const tradeUnitsMatch = currentTus.length > 0 && savedTus.length > 0
      && currentTus.length === savedTus.length
      && currentTus.every(tu => savedTus.includes(tu));

    if (!tradeUnitsMatch) {
      this.appState.clearBuildListState();
      return;
    }

    this.queryText.set(saved.queryText);
    this.hasGenerated.set(saved.hasGenerated);
    this.showMap.set(saved.showMap);
    this.detectedState.set(saved.detectedState);
    if (saved.selectedLibraryQuery) this.selectedLibraryQuery.set(saved.selectedLibraryQuery);
    if (saved.activeSavedList) this.activeSavedList.set(saved.activeSavedList);
    if (saved.appliedRefinements) {
      this.appliedRefinements.set(saved.appliedRefinements);
      this.pendingRefinements.set(saved.appliedRefinements);
    }
    if (saved.notContactedDaysInput) this.notContactedDaysInput.set(saved.notContactedDaysInput);
    if (saved.showRefinePanel) this.showRefinePanel.set(saved.showRefinePanel);
    if (saved.manuallyExcludedCustomerIds?.length) {
      this.manuallyExcludedCustomerIds.set(new Set(saved.manuallyExcludedCustomerIds));
    }
    if (saved.manuallyIncludedCustomerIds?.length) {
      // Store as pending — resolved to full Customer objects after data loads in _initLoad
      this._pendingIncludedIds = saved.manuallyIncludedCustomerIds;
    }
    if (saved.showManageMembersPanel) this.showManageMembersPanel.set(true);
    // Note: filteredCustomers are restored by _initLoad after data signals are set
  }

  toggleMap(): void {
    this.showMap.update(v => !v);
  }

  readonly mapCustomers = computed(() =>
    this.hasGenerated() ? this.displayedCustomers() : this.customers()
  );

  clearQuery(): void {
    this._queryGenId++;
    this.isProcessing.set(false);
    this.waitingForTickets.set(false);
    this.queryText.set('');
    this.hasGenerated.set(false);
    this.filteredCustomers.set([]);
    this.matchedPatterns.set([]);
    this.detectedState.set(null);
    this.queryReturnedNoMatches.set(false);
    this.showMap.set(false);
    this.librarySearchText.set('');
    this.selectedCategory.set(this.selectedLibraryQuery()?.category ?? null);
    this.selectedLibraryQuery.set(null);
    this.showRefinePanel.set(false);
    this.pendingRefinements.set({});
    this.appliedRefinements.set({});
    this.notContactedDaysInput.set('');
    this.showManageMembersPanel.set(false);
    this.manuallyIncludedCustomers.set([]);
    this.manuallyExcludedCustomerIds.set(new Set());
    this.memberSearchTerm.set('');
    this.memberSearchResults.set([]);
    this.activeSavedList.set(null);
    this.appState.clearBuildListState();
  }

  /** Called when user clicks a query card from the library. */
  selectLibraryQuery(item: QueryLibraryItem): void {
    // Reset non-visual state from any previous query or saved list.
    this._queryGenId++;
    this.isProcessing.set(false);
    this.waitingForTickets.set(false);
    this.queryReturnedNoMatches.set(false);
    this.showRefinePanel.set(false);
    this.pendingRefinements.set({});
    this.appliedRefinements.set({});
    this.notContactedDaysInput.set('');
    this.showManageMembersPanel.set(false);
    this.manuallyIncludedCustomers.set([]);
    this.manuallyExcludedCustomerIds.set(new Set());
    this.memberSearchTerm.set('');
    this.memberSearchResults.set([]);
    this.memberInResultsMatches.set([]);
    this.activeSavedList.set(null);

    this.queryText.set(item.queryText);
    this.selectedLibraryQuery.set(item);
    this.usageTracking.postClickEvent('interaction', 'build-a-list', 'library-query-selected', item.id.toString());
    // Always route through processQuery — it handles data loading (tickets, storage),
    // spinner state, and the NLQ filter. Avoids the edge case where _applyNlqFilter
    // runs before secondary data (storage, tickets) has loaded.
    this.processQuery();
  }

  /** Handles typing in the library search input. Logs unmatched searches after 2s debounce. */
  onLibrarySearchChange(text: string): void {
    this.librarySearchText.set(text);
    if (this._searchLogTimeout) clearTimeout(this._searchLogTimeout);
    if (!text.trim()) return;
    this._searchLogTimeout = setTimeout(() => {
      // Only auto-log if the request form isn't open (user hasn't clicked "Request a query")
      // to avoid double-logging when they submit the form.
      if (this.filteredLibrary().length === 0 && !this.showRequestForm()) {
        this.apiService.logQuerySearch(text.trim())
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe();
        this.usageTracking.postClickEvent('interaction', 'build-a-list', 'library-search-no-match', text.trim());
      }
    }, 2000);
  }

  /** Submits a query request to the search log so admins can see what users are asking for. */
  submitQueryRequest(): void {
    const text = this.requestQueryText().trim();
    if (!text) return;
    // Cancel any pending auto-log so we don't double-log
    if (this._searchLogTimeout) { clearTimeout(this._searchLogTimeout); this._searchLogTimeout = null; }
    this.apiService.logQuerySearch(text)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.toastService.success('Request submitted — we\'ll review and add it to the library');
        this.requestQueryText.set('');
        this.showRequestForm.set(false);
      });
    this.usageTracking.postClickEvent('interaction', 'build-a-list', 'query-request-submitted', text);
  }

  /** Retry after a contracts-fetch failure surfaced the "couldn't load contract data" panel.
   *  Sets isProcessing so the existing spinner shows, then re-fetches everything fresh; the
   *  _dataReadyEffect re-applies the active query once core data lands. If contracts come back
   *  this time, the panel clears and results render; if it fails again, the panel reappears. */
  retryContractLoad(): void {
    this.isProcessing.set(true);
    this._loadFresh(true);
  }

  processQuery(overrideTradeUnits?: string[]): void {
    if (!this.queryText().trim()) return;
    // Don't run if core data hasn't loaded yet — set isProcessing so the _dataReadyEffect
    // auto-triggers this query when coreDataLoaded becomes true.
    if (!this.coreDataLoaded()) {
      this.isProcessing.set(true);
      return;
    }

    const queryGen = ++this._queryGenId;
    this.isProcessing.set(true);
    this.waitingForTickets.set(false); // Reset — will be set to true below only if this query needs tickets

    // Saved lists always re-fetch to ensure fresh data
    if (overrideTradeUnits && overrideTradeUnits.length > 0) {
      this._fetchAndFilter(overrideTradeUnits);
      return;
    }

    // If query needs tickets and they haven't loaded yet, wait for them specifically.
    // Tickets are the only data loaded outside the main forkJoin (background subscription),
    // so they're the only ones that might genuinely not be available yet.
    const needsTickets = this.nlqFilterService.queryInvolvesTickets(this.queryText());
    if (needsTickets && !this._ticketsReady()) {
      this.waitingForTickets.set(true);
      return;
    }

    // If the query needs contracts and a fresh contracts fetch hasn't confirmed yet, wait.
    // coreDataLoaded can be true with stale/empty cached contracts (cache-restore path sets it
    // before the background refresh lands), so trusting it alone let "All producers with
    // contracts" run against a not-yet-loaded set and falsely return zero. isProcessing is
    // already true here, so _dataReadyEffect re-runs this query once _contractsReady flips.
    const needsContracts = this.nlqFilterService.queryInvolvesContracts(this.queryText());
    if (needsContracts && !this._contractsReady()) {
      return;
    }

    // All other data (notes, storage, planting) comes from the forkJoin
    // which completes before coreDataLoaded is set. Run the NLQ immediately.
    this.waitingForTickets.set(false);
    this._applyNlqFilter();
    this.isProcessing.set(false);
  }

  /** Fetches fresh data for specific trade units and runs the NLQ filter. */
  private _fetchAndFilter(tradeUnits: string[]): void {
    const queryGen = this._queryGenId; // Capture to detect if a newer query supersedes this one
    // Reset the contracts-failure flag — a fresh fetch is about to (re)determine it.
    this.contractsLoadFailed.set(false);

    // Fast path: if requested TUs match what's already loaded AND all data the query
    // needs is ready, skip the fetch and run NLQ directly against in-memory data.
    const currentTus = this.appState.selectedTradeUnits();
    const tusMatch = tradeUnits.length === currentTus.length
      && tradeUnits.every(tu => currentTus.includes(tu));
    const query = this.queryText().toLowerCase();
    const needsTickets = this.nlqFilterService.queryInvolvesTickets(query);
    const needsStorage = this.nlqFilterService.queryInvolvesStorage(query);
    const needsNotes = this.nlqFilterService.queryInvolvesContact(query);
    const ticketsOk = !needsTickets || this._ticketsReady();
    const storageOk = !needsStorage || this.storedGrain().length > 0;
    const notesOk = !needsNotes || this.notes().length > 0;
    if (tusMatch && this.coreDataLoaded() && this.customers().length > 0 && ticketsOk && storageOk && notesOk) {
      this._resolvePendingIncludes();
      this._applyNlqFilter();
      this.isProcessing.set(false);
      return;
    }

    const tuParam = tradeUnits.length > 0 ? tradeUnits : undefined;
    forkJoin({
      customers: this.apiService.getCustomers(tuParam).pipe(catchError(() => of([] as Customer[]))),
      contracts: this.apiService.getContracts(tuParam).pipe(catchError(() => { this.contractsLoadFailed.set(true); return of([] as Contract[]); })),
      tickets: this.apiService.getTickets(tuParam).pipe(catchError(() => of([] as Ticket[]))),
      plantingIntentions: this.apiService.getPlantingIntentions(tuParam).pipe(catchError(() => of([] as PlantingIntention[]))),
      notes: this.apiService.getNotes().pipe(catchError(() => of([] as Note[]))),
      storedGrain: this.apiService.getStoredGrain(tuParam).pipe(catchError(() => of([] as StoredGrain[]))),
      producerDetails: (this.appState.producerDetails().length > 0 ? of(this.appState.producerDetails()) : this.apiService.getAllProducerDetails()).pipe(catchError(() => of([] as ProducerDetails[])))
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        if (queryGen !== this._queryGenId) return; // Superseded by a newer query
        this.customers.set(data.customers);
        this._mergeProducerDetails(data.producerDetails);
        this.contracts.set(data.contracts);
        this.tickets.set(data.tickets);
        this.notes.set(data.notes);
        this.plantingIntentions.set(data.plantingIntentions);
        this.storedGrain.set(data.storedGrain);
        this._ticketsReady.set(true);
        this.coreDataLoaded.set(true);
        this._resolvePendingIncludes();

        this._applyNlqFilter();
        this.isProcessing.set(false);
      },
      error: () => {
        if (queryGen !== this._queryGenId) return;
        this.toastService.error('Failed to load data for query');
        this.isProcessing.set(false);
      }
    });
  }

  /**
   * Resolves first-person references ("me", "my", "I") in a query to the current user's
   * display name or username so note author searches work with self-referencing queries
   * like "notes by me", "customers I have contacted", "my notes".
   */
  /** Resolves pending included customer IDs to full Customer objects from the now-loaded data. */
  private _resolvePendingIncludes(): void {
    if (this._pendingIncludedIds.length === 0) return;
    const customerMap = new Map(this.customers().map(c => [c.id, c]));
    this.manuallyIncludedCustomers.set(
      this._pendingIncludedIds.map(id => customerMap.get(id)).filter((c): c is Customer => !!c)
    );
    this._pendingIncludedIds = [];
    // Auto-open panel now that included customers are resolved
    if (this.manuallyIncludedCustomers().length > 0) {
      this.showManageMembersPanel.set(true);
    }
  }

  private _resolveUserReferences(query: string): string {
    const account = this.msalService.instance.getActiveAccount()
      ?? this.msalService.instance.getAllAccounts()[0];
    return this.nlqFilterService.resolveUserReferences(query, account?.name ?? '', account?.username ?? '');
  }

  /** Runs the NLQ filter against the current in-memory data and updates filteredCustomers. */
  private _applyNlqFilter(): void {
    // Pass all contracts (open + prior-year closed) to NLQ — the filter service handles
    // status-specific filtering internally, and pacing queries need both years to compare.
    // Threading MSAL identity into the context so author-scoped contact / note filters
    // ("Producers I contacted this week") can recognize "by me" notes whose CreatedBy survives
    // as the raw email when UserTradeUnitSnapshot has no row for this user.
    const account = this.msalService.instance.getActiveAccount()
      ?? this.msalService.instance.getAllAccounts()[0];
    const context: NlqFilterContext = {
      customers: this.customers(),
      contracts: this.contracts(),
      tickets: this.tickets(),
      notes: this.notes(),
      plantingIntentions: this.plantingIntentions(),
      storedGrain: this.storedGrain(),
      commodities: this.appState.commodities(),
      currentUserDisplayName: account?.name ?? '',
      currentUserUsername: account?.username ?? ''
    };
    const resolvedQuery = this._resolveUserReferences(this.queryText());
    const result = this.nlqFilterService.parseAndFilter(resolvedQuery, context);
    this.detectedState.set(result.detectedState);
    this.matchedPatterns.set(result.matchedPatterns);
    this.hasGenerated.set(true);
    // Don't show "no match" if tickets are still loading and the query needs them.
    // Belt-and-braces: _ticketsReady can flip true even when the local fetch returned []
    // and home's appState hadn't backfilled yet (see _appStateTicketsEffect). In that case
    // we'd race against empty data and the user would see "no producers" on the first
    // run, then see results on the second after the effect re-hydrates. Treat an empty
    // local tickets array as still-loading too — the effect will re-run NLQ automatically
    // once appState catches data. Suppresses the misleading 0-result flash.
    const queryNeedsTickets = this.nlqFilterService.queryInvolvesTickets(this.queryText());
    const ticketsPending = queryNeedsTickets && (!this._ticketsReady() || this.tickets().length === 0);
    this.waitingForTickets.set(ticketsPending);
    this.queryReturnedNoMatches.set(result.customers.length === 0 && !ticketsPending);
    this.filteredCustomers.set(result.customers);

    // If the query mentions pacing, apply direction filtering here at the component level
    // Harvest-window-based pacing direction — overrides the NLQ service's internal pacing
    // calculation with the same logic the customer profile pacing card uses.
    const lq = this.queryText().toLowerCase();
    if (lq.includes('pacing') || lq.includes('contract pace')) {
      const isNegative = lq.includes('negative') || lq.includes('behind') || lq.includes('below') || lq.includes('slower') || lq.includes('down');
      const isPositive = lq.includes('positive') || lq.includes('ahead') || lq.includes('above') || lq.includes('faster') || lq.includes('up');
      if (isNegative || isPositive) {
        const allCustomersWithContracts = this.customers().filter(c =>
          (this._contractsByCustomer().get(c.scoularId!) || []).length > 0
        );
        const pacingResults = allCustomersWithContracts.filter(c => {
          const dir = this._getCustomerPacingDirection(c);
          if (dir === null) return false;
          return isNegative ? dir === 'down' : dir === 'up';
        });
        this.filteredCustomers.set(pacingResults);
        // Recompute no-match banner based on the pacing-filtered results
        this.queryReturnedNoMatches.set(pacingResults.length === 0);
      }
    }

    // Planting coverage queries — fetch from base.Contract for accurate historical matching.
    // Overrides the NLQ cross-entity result which uses vw_CurrentContracts.
    const isCoverageQuery = (lq.includes('planting') && (lq.includes('no contract') || lq.includes('no active contract')))
      || lq.includes('percent contracted') || lq.includes('uncontracted');
    if (isCoverageQuery) {
      this._applyPlantingCoverageFilter(lq);
      return; // async — will set filteredCustomers when done
    }
  }



  getStateDisplayName(state: string): string {
    return this.nlqFilterService.getStateDisplayName(state);
  }

  loadSavedList(list: SavedList): void {
    if (this.loading() || this.isProcessing()) {
      // Don't drop the click silently — tell the user why nothing happened so they aren't
      // wondering whether the click landed. The processing spinner is already on screen but
      // can be easy to miss if focus is on the library panel.
      this.toastService.info('Still loading — please wait a moment and try again');
      return;
    }
    this.usageTracking.postClickEvent('interaction', 'build-a-list', 'saved-list-loaded', list.id.toString());
    this.activeSavedList.set(list);
    this.queryText.set(list.query);
    // Do NOT set selectedLibraryQuery here — that would make the "Active Query" indicator
    // show the library prompt's name (not the saved list), and its "Change" button calls
    // clearQuery() which wipes activeSavedList — breaking the save-as-update flow. Instead
    // we render an "Active List" indicator for the saved list and the refine-panel section
    // visibility derives from a separate computed (effectiveLibraryCategory) that looks up
    // the matching library item by queryText.
    this.pendingRefinements.set(list.filters ? { ...list.filters } : {});
    this.appliedRefinements.set({ ...this.pendingRefinements() });
    this.notContactedDaysInput.set(
      this.appliedRefinements().notContactedDays != null
        ? this.appliedRefinements().notContactedDays!.toString()
        : ''
    );
    // Restore manual member overrides — excluded IDs can be set immediately (just numbers).
    // Included customers need full Customer objects, which are resolved after data loads
    // (in case the saved list uses different TUs than what's currently loaded).
    this.manuallyExcludedCustomerIds.set(new Set(list.excludedCustomerIds || []));
    this._pendingIncludedIds = list.includedCustomerIds ?? [];
    this.manuallyIncludedCustomers.set([]);
    // Don't auto-open the Refine Filters or Manage Members panels — show the results first;
    // the user can open either panel themselves if they want to edit. The active filter / member
    // counts are still visible on the toggle buttons so they know data is loaded underneath.
    this.showRefinePanel.set(false);
    this.showManageMembersPanel.set(false);
    // Clear stale results before fetching so no intermediate render fires with the
    // enriched cache that home page customer visits leave in appState.contracts.
    this.filteredCustomers.set([]);
    this.hasGenerated.set(false);
    // Always use the trade units saved with the list, not the current UI selection.
    // This ensures the results are deterministic regardless of what trade units are
    // currently selected in the header — the list was built against specific trade units.
    const savedTradeUnits = list.tradeUnits
      ? list.tradeUnits.split(',').map(t => t.trim()).filter(Boolean)
      : [];
    this.processQuery(savedTradeUnits);
  }

  clearRefinements(): void {
    this.pendingRefinements.set({});
    this.appliedRefinements.set({});
    this.notContactedDaysInput.set('');
  }

  applyNotContactedDays(): void {
    const days = parseInt(this.notContactedDaysInput(), 10);
    this.pendingRefinements.update(r => ({ ...r, notContactedDays: isNaN(days) || days <= 0 ? null : days }));
  }

  applyFilters(): void {
    // Setting appliedRefinements is sufficient — displayedCustomers computed signal
    // automatically recalculates when appliedRefinements() changes. No need to re-run
    // the full NLQ parse/filter pipeline since the base filteredCustomers hasn't changed.
    this.appliedRefinements.set({ ...this.pendingRefinements() });
  }

  togglePendingCrop(crop: string): void {
    const current = this.pendingRefinements().crops ?? [];
    const updated = current.includes(crop) ? current.filter(c => c !== crop) : [...current, crop];
    this.pendingRefinements.update(r => ({ ...r, crops: updated.length > 0 ? updated : undefined }));
  }

  togglePendingState(state: string): void {
    const current = this.pendingRefinements().states ?? [];
    const updated = current.includes(state) ? current.filter(s => s !== state) : [...current, state];
    this.pendingRefinements.update(r => ({ ...r, states: updated.length > 0 ? updated : undefined }));
  }

  isCropSelected(crop: string): boolean {
    return !!(this.pendingRefinements().crops?.includes(crop));
  }

  isStateSelected(state: string): boolean {
    return !!(this.pendingRefinements().states?.includes(state));
  }

  // ── Manage Members methods ─────────────────────────────────────────────

  /** Matches from current displayed results (available to exclude). */
  memberInResultsMatches = signal<Customer[]>([]);

  searchMembers(term: string): void {
    if (this._memberSearchTimeout) clearTimeout(this._memberSearchTimeout);
    if (!term.trim() || term.trim().length < 2) {
      this.memberSearchResults.set([]);
      this.memberInResultsMatches.set([]);
      this.memberSearchLoading.set(false);
      return;
    }

    // Immediately filter current results for exclude candidates (client-side, instant).
    // "In results" includes both visible peer rows and linked producers reachable
    // through their expanded panels, so a linked producer doesn't get mislabeled as add-only.
    const lower = term.trim().toLowerCase();
    const excludedIds = this.manuallyExcludedCustomerIds();
    const logicalIds = this.logicallyInResultsIds();
    const allCustomers = this.customers();
    const matchesTerm = (c: Customer) =>
      c.name.toLowerCase().includes(lower) ||
      (c.scoularId || '').toLowerCase().includes(lower) ||
      (c.farm || '').toLowerCase().includes(lower);

    this.memberInResultsMatches.set(
      allCustomers
        .filter(c => logicalIds.has(c.id) && !excludedIds.has(c.id) && matchesTerm(c))
        .slice(0, 5)
    );

    // Debounced API search for add candidates — anything already logically in
    // results (peer or linked sub-row) is filtered out.
    this.memberSearchLoading.set(true);
    this._memberSearchTimeout = setTimeout(() => {
      const tus = this.effectiveTradeUnits();
      this.apiService.searchCustomers(term, tus.length > 0 ? tus : undefined)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (results) => {
            const includedIds = new Set(this.manuallyIncludedCustomers().map(c => c.id));
            const inList = this.logicallyInResultsIds();
            this.memberSearchResults.set(
              results.filter(c => !includedIds.has(c.id) && !inList.has(c.id)).slice(0, 5)
            );
            this.memberSearchLoading.set(false);
          },
          error: () => {
            this.memberSearchResults.set([]);
            this.memberSearchLoading.set(false);
          }
        });
    }, 300);
  }

  addCustomerToList(customer: Customer): void {
    // Remove from excluded if they were previously excluded
    const excluded = this.manuallyExcludedCustomerIds();
    if (excluded.has(customer.id)) {
      const updated = new Set(excluded);
      updated.delete(customer.id);
      this.manuallyExcludedCustomerIds.set(updated);
    }
    // Add to included if not already there
    if (!this.manuallyIncludedCustomers().some(c => c.id === customer.id)) {
      this.manuallyIncludedCustomers.update(list => [...list, customer]);
    }
    // Keep the search open so several people from the same result set can be added/excluded
    // in a row (e.g. related producers) without retyping. Just drop this person from the
    // candidate lists; the rest stay selectable.
    this.memberSearchResults.update(list => list.filter(c => c.id !== customer.id));
    this.memberInResultsMatches.update(list => list.filter(c => c.id !== customer.id));
    this.usageTracking.postClickEvent('interaction', 'build-a-list', 'member-added', customer.id.toString());
  }

  excludeCustomerFromList(customerId: number): void {
    // If this was a manually added customer, just remove the add
    const wasManualAdd = this.manuallyIncludedCustomers().some(c => c.id === customerId);
    if (wasManualAdd) {
      this.manuallyIncludedCustomers.update(list => list.filter(c => c.id !== customerId));
    } else {
      // Add to excluded set (for NLQ-matched customers)
      this.manuallyExcludedCustomerIds.update(set => {
        const updated = new Set(set);
        updated.add(customerId);
        return updated;
      });
    }
    // Keep the search open so several people from the same result set can be excluded/added
    // in a row without retyping. Just drop this person from the candidate lists.
    this.memberInResultsMatches.update(list => list.filter(c => c.id !== customerId));
    this.memberSearchResults.update(list => list.filter(c => c.id !== customerId));
    this.usageTracking.postClickEvent('interaction', 'build-a-list', 'member-excluded', customerId.toString());
  }

  restoreCustomer(customerId: number): void {
    this.manuallyExcludedCustomerIds.update(set => {
      const updated = new Set(set);
      updated.delete(customerId);
      return updated;
    });
  }

  /**
   * Harvest-window-based pacing direction for a customer.
   * Returns 'down' if ANY commodity's bushels declined year-over-year,
   * 'up' if at least one increased and none declined, 'flat' if no movement, null if no data.
   * Mirrors the contract-pacing-card logic so the build-a-list result matches
   * the arrow the user sees on the customer profile.
   */
  private _getCustomerPacingDirection(customer: Customer): 'up' | 'down' | 'flat' | null {
    const customerContracts = this._contractsByCustomer().get(customer.scoularId!) || [];
    if (customerContracts.length === 0) return null;
    const windows = this.appState.harvestWindows().filter(hw => hw.isActive !== false);
    if (windows.length === 0) return null;
    const year = new Date().getFullYear();
    let anyDown = false;
    let anyData = false;
    let anyMovement = false;
    for (const hw of windows) {
      let thisYear = 0;
      let lastYear = 0;
      for (const c of customerContracts) {
        if (!this._contractMatchesPacingCommodity(c, hw.commodity)) continue;
        if (this._contractOverlapsWindow(c, hw, year)) thisYear += c.quantity;
        if (this._contractOverlapsWindow(c, hw, year - 1)) lastYear += c.quantity;
      }
      if (thisYear === 0 && lastYear === 0) continue;
      anyData = true;
      if (thisYear < lastYear) { anyDown = true; anyMovement = true; }
      else if (thisYear > lastYear) { anyMovement = true; }
    }
    if (!anyData) return null;
    if (anyDown) return 'down';
    return anyMovement ? 'up' : 'flat';
  }

  private _contractOverlapsWindow(c: Contract, hw: { deliveryStartMonth: number; deliveryStartDay: number; deliveryEndMonth: number; deliveryEndDay: number }, cropYear: number): boolean {
    if (!c.deliveryStart && !c.deliveryEnd) return false;
    const wStart = new Date(cropYear, hw.deliveryStartMonth - 1, hw.deliveryStartDay);
    const wEnd = new Date(cropYear, hw.deliveryEndMonth - 1, hw.deliveryEndDay);
    wEnd.setHours(23, 59, 59, 999);
    const dStart = c.deliveryStart ? new Date(c.deliveryStart) : new Date(c.deliveryEnd!);
    const dEnd = c.deliveryEnd ? new Date(c.deliveryEnd) : new Date(c.deliveryStart!);
    return dStart <= wEnd && dEnd >= wStart;
  }

  private _contractMatchesPacingCommodity(c: Contract, hwCommodity: string): boolean {
    const target = hwCommodity.trim().toUpperCase();
    if (!target) return false;
    const group = (c.commodityGroup || '').trim().toUpperCase();
    if (group && group === target) return true;
    const desc = (c.commodityDescription || '').trim().toUpperCase();
    if (desc && desc.includes(target)) return true;
    const code = (c.commodityCode || '').trim().toUpperCase();
    if (code && code.includes(target)) return true;
    return false;
  }

  /**
   * Fetches contracts from base.Contract for each planting year, then applies coverage logic.
   * Used by "0% coverage", "under 50% contracted", and "highest uncontracted" queries.
   */
  private _applyPlantingCoverageFilter(lq: string): void {
    const intentions = this.plantingIntentions();
    if (intentions.length === 0) {
      this.filteredCustomers.set([]);
      this.queryReturnedNoMatches.set(true);
      return;
    }

    // Unique planting years to fetch
    const years = [...new Set(intentions.map(p => p.plantingYear).filter(Boolean))];
    if (years.length === 0) {
      this.filteredCustomers.set([]);
      return;
    }

    this.isProcessing.set(true);
    const tuParam = this.appState.selectedTradeUnits();
    const tus = tuParam.length > 0 ? tuParam : undefined;

    // Fetch contracts from base.Contract for each planting year in parallel
    forkJoin(years.map(y => this.apiService.getContractsByCropYear(y, tus).pipe(
      catchError(() => of([] as Contract[]))
    ))).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(results => {
      // Merge all fetched contracts
      const allContracts: Contract[] = [];
      for (const batch of results) allContracts.push(...batch);

      // Index contracts by customer + year + commodity
      const contractsByCustomer = new Map<string, Contract[]>();
      for (const c of allContracts) {
        if (!c.ctrmCustomerId) continue;
        const arr = contractsByCustomer.get(c.ctrmCustomerId);
        if (arr) arr.push(c); else contractsByCustomer.set(c.ctrmCustomerId, [c]);
      }

      // Group planting by customer → array of { year, crop, acres }
      const plantingByCustomer = new Map<number, { year: number; crop: string; acres: number }[]>();
      for (const p of intentions) {
        const crop = (p.crop || '').trim().toUpperCase();
        if (!crop || !p.plantingYear) continue;
        const arr = plantingByCustomer.get(p.customerId);
        const entry = { year: p.plantingYear, crop, acres: p.acres };
        if (arr) arr.push(entry); else plantingByCustomer.set(p.customerId, [entry]);
      }

      const allCustomers = this.customers();

      // Helper: check if a contract covers a specific crop
      const contractMatchesCrop = (ct: Contract, crop: string): boolean => {
        const code = (ct.commodityCode || '').trim().toUpperCase();
        const desc = (ct.commodityDescription || '').trim().toUpperCase();
        const group = (ct.commodityGroup || '').trim().toUpperCase();
        return code.includes(crop) || crop.includes(code) ||
               desc.includes(crop) || crop.includes(desc) ||
               group.includes(crop) || crop.includes(group);
      };

      if (lq.includes('planting') && (lq.includes('no contract') || lq.includes('no active contract'))) {
        // 0% coverage: any planting crop+year with zero matching contracts
        this.filteredCustomers.set(allCustomers.filter(c => {
          const plantings = plantingByCustomer.get(c.id);
          if (!plantings) return false;
          const custContracts = contractsByCustomer.get(c.scoularId!) || [];
          return plantings.some(p =>
            !custContracts.some(ct => ct.cropYear === p.year && contractMatchesCrop(ct, p.crop))
          );
        }));
      } else if (lq.includes('under') && lq.includes('percent contracted')) {
        // Under X% coverage: planting bushels vs contracted bushels per crop+year
        const pctMatch = lq.match(/under\s+(\d+)\s*percent/);
        const threshold = pctMatch ? parseInt(pctMatch[1]) / 100 : 0.5;
        // Need yield estimates to calculate estimated production
        const yieldEstimates = this.appState.dashboardCache()?.savedYieldEstimates || [];
        const yieldMap = new Map<string, number>();
        for (const e of yieldEstimates) {
          if (e.yieldEstimate != null) yieldMap.set(e.crop, e.yieldEstimate);
        }

        this.filteredCustomers.set(allCustomers.filter(c => {
          const plantings = plantingByCustomer.get(c.id);
          if (!plantings) return false;
          const custContracts = contractsByCustomer.get(c.scoularId!) || [];
          // Check each planting crop: estimated production vs contracted bushels
          return plantings.some(p => {
            const yieldEst = yieldMap.get(p.crop);
            if (!yieldEst) return false; // can't calculate without yield
            const estimatedProduction = p.acres * yieldEst;
            const contractedBu = custContracts
              .filter(ct => ct.cropYear === p.year && contractMatchesCrop(ct, p.crop))
              .reduce((sum, ct) => sum + (ct.quantity ?? 0), 0);
            const coverage = estimatedProduction > 0 ? contractedBu / estimatedProduction : 0;
            return coverage < threshold;
          });
        }));
      } else if (lq.includes('uncontracted')) {
        // Highest uncontracted bushels — top 10 by gap
        const yieldEstimates = this.appState.dashboardCache()?.savedYieldEstimates || [];
        const yieldMap = new Map<string, number>();
        for (const e of yieldEstimates) {
          if (e.yieldEstimate != null) yieldMap.set(e.crop, e.yieldEstimate);
        }

        const customerGaps: { customer: Customer; gap: number }[] = [];
        for (const c of allCustomers) {
          const plantings = plantingByCustomer.get(c.id);
          if (!plantings) continue;
          const custContracts = contractsByCustomer.get(c.scoularId!) || [];
          let totalGap = 0;
          for (const p of plantings) {
            const yieldEst = yieldMap.get(p.crop);
            if (!yieldEst) continue;
            const estimatedProduction = p.acres * yieldEst;
            const contractedBu = custContracts
              .filter(ct => ct.cropYear === p.year && contractMatchesCrop(ct, p.crop))
              .reduce((sum, ct) => sum + (ct.quantity ?? 0), 0);
            totalGap += Math.max(0, estimatedProduction - contractedBu);
          }
          if (totalGap > 0) customerGaps.push({ customer: c, gap: totalGap });
        }
        customerGaps.sort((a, b) => b.gap - a.gap);
        this.filteredCustomers.set(customerGaps.slice(0, 10).map(g => g.customer));
      }

      this.queryReturnedNoMatches.set(this.filteredCustomers().length === 0);
      this.isProcessing.set(false);
    });
  }

  hasAnyRefinement(filters: RefinementFilters): boolean {
    return !!(
      filters.noActiveContracts ||
      filters.hasUnsignedContracts ||
      filters.downHarvestPace ||
      filters.hasUnpricedContracts ||
      filters.hasOverdueContracts ||
      filters.noContractsAtAll ||
      (filters.contractQuantityOver != null && filters.contractQuantityOver > 0) ||
      filters.contractsExpiringThisMonth ||
      filters.multipleCommoditiesContracted ||
      filters.neverContacted ||
      (filters.notContactedDays != null && filters.notContactedDays > 0) ||
      (filters.notesInLastDays != null && filters.notesInLastDays > 0) ||
      filters.contactedOnlyOnce ||
      filters.contactedMoreThan5 ||
      filters.contactedByMeOnly ||
      filters.contactedBySomeoneElse ||
      filters.hasPinnedNotes ||
      filters.noteKeyword?.trim() ||
      (filters.acresOver != null && filters.acresOver > 0) ||
      filters.hasBinCapacity || filters.noBinCapacity ||
      filters.hasPrimaryContact || filters.noPrimaryContact ||
      filters.hasEmail || filters.hasPhone || filters.hasLinkedProducers || filters.notEsignEnrolled ||
      filters.hasActiveContracts || filters.hasDeliveriesThisYear ||
      filters.hasPlantingIntentions || filters.hasGrainInStorage ||
      (filters.ticketQuantityOver != null && filters.ticketQuantityOver > 0) ||
      (filters.ticketsInLastDays != null && filters.ticketsInLastDays > 0) ||
      filters.avgMoistureOver != null || filters.avgMoistureUnder != null ||
      filters.avgTestWeightOver != null || filters.avgTestWeightUnder != null ||
      filters.avgProteinOver != null || filters.avgProteinUnder != null ||
      (filters.storageDaysOver != null && filters.storageDaysOver > 0) ||
      (filters.storageQuantityOver != null && filters.storageQuantityOver > 0) ||
      (filters.storageReceivableOver != null && filters.storageReceivableOver > 0) ||
      filters.plantingYear != null || filters.irrigatedOnly || filters.drylandOnly || filters.doubleCropOnly ||
      (filters.plantingAcresOver != null && filters.plantingAcresOver > 0) ||
      (filters.crops && filters.crops.length > 0) ||
      (filters.states && filters.states.length > 0)
    );
  }

  openSaveDialog(): void {
    this.showSaveDialog.set(true);
    this.newListName.set(this.activeSavedList()?.name ?? '');
  }

  closeSaveDialog(): void {
    this.showSaveDialog.set(false);
  }

  toggleRefinePanel(): void {
    const opening = !this.showRefinePanel();
    this.showRefinePanel.update(v => !v);
    if (opening) this.usageTracking.postClickEvent('interaction', 'build-a-list', 'refine-filters');
  }

  toggleManageMembersPanel(): void {
    const opening = !this.showManageMembersPanel();
    this.showManageMembersPanel.update(v => !v);
    if (opening) this.usageTracking.postClickEvent('interaction', 'build-a-list', 'manage-members');
  }

  saveList(): void {
    if (!this.newListName().trim() || this.displayedCustomers().length === 0) return;
    this.usageTracking.postClickEvent('interaction', 'build-a-list', 'save-list');

    const tradeUnits = this.effectiveTradeUnits();
    const includedIds = this.manuallyIncludedCustomers().map(c => c.id);
    const excludedIds = [...this.manuallyExcludedCustomerIds()];
    // Resolve the prompt's library category (Contracts / Tickets / etc.) and persist it as a
    // private hint on the filters so home/customer-list can run the dimension-aware crops filter
    // identically — they don't load the query library and can't recover the category from
    // queryText otherwise. Build-list reads it back too, but its own UI uses effectiveLibraryCategory.
    const category = this.effectiveLibraryCategory();
    const baseFilters = this.activeRefinementCount() > 0 ? { ...this.appliedRefinements() } : null;
    const filtersWithCategory = baseFilters
      ? (category ? { ...baseFilters, _promptCategory: category } : baseFilters)
      : (category ? { _promptCategory: category } : undefined);

    const payload = {
      name: this.newListName(),
      query: this.queryText(),
      tradeUnits: tradeUnits.length > 0 ? tradeUnits.join(',') : undefined,
      filters: filtersWithCategory,
      includedCustomerIds: includedIds.length > 0 ? includedIds : undefined,
      excludedCustomerIds: excludedIds.length > 0 ? excludedIds : undefined,
    };

    const request$ = this.activeSavedList()
      ? this.apiService.updateSavedList(this.activeSavedList()!.id, payload)
      : this.apiService.createSavedList(payload);

    // Clear state immediately so navigating away before the API responds
    // doesn't leave stale results in the build list state cache.
    const listName = this.newListName();
    this.showSaveDialog.set(false);
    this.clearQuery();

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toastService.success(`List "${listName}" saved`);
        this._refreshSavedLists();
      },
      error: () => {
        this.toastService.error('Failed to save list');
      }
    });
  }

  deleteList(listId: number): void {
    this.deleteListId.set(listId);
    this.showDeleteDialog.set(true);
  }

  closeDeleteDialog(): void {
    this.showDeleteDialog.set(false);
    this.deleteListId.set(null);
  }

  confirmDeleteList(): void {
    if (!this.deleteListId()) return;
    const listId = this.deleteListId()!;
    this.usageTracking.postClickEvent('interaction', 'build-a-list', 'saved-list-deleted', listId.toString());
    this.closeDeleteDialog();

    // Remove from local array immediately for instant UI feedback
    this.savedLists.update(lists => lists.filter(l => l.id !== listId));
    this.appState.setSavedLists(this.savedLists());
    if (this.activeSavedList()?.id === listId) {
      this.activeSavedList.set(null);
    }

    this.apiService.deleteSavedList(listId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toastService.info('List deleted');
      },
      error: () => {
        this.toastService.error('Failed to delete list');
        this._refreshSavedLists(); // Re-fetch on error to restore
      }
    });
  }

  private _refreshSavedLists(): void {
    this.apiService.getSavedLists().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.savedLists.set(data);
        this.appState.setSavedLists(data);
      },
      error: () => this.toastService.error('Failed to refresh lists')
    });
  }

  selectCustomer(customer: Customer): void {
    this.usageTracking.trackProfileOpened(customer.id.toString());
    const tab = this._detectFocusTab();
    const params: Record<string, string | number> = { customerId: customer.id };
    if (tab) params['tab'] = tab;
    this.router.navigate(['/'], { queryParams: params });
  }

  /** Map the active prompt/filter context to a customer-profile tab so that
   *  clicking a producer lands on the section relevant to why they're in the
   *  result list. Returns null when there's no clear focus (e.g., notes are
   *  always visible in the sidebar, so no tab override is needed). */
  private _detectFocusTab(): string | null {
    const r = this.appliedRefinements();
    const q = this.queryText().toLowerCase();

    // Notes already visible in the sidebar — no tab override needed.
    if (this.noteFilterActive()) return null;

    // Storage
    if (q.includes('storage') || q.includes('stored grain') ||
        (r.storageDaysOver != null && r.storageDaysOver > 0) ||
        (r.storageQuantityOver != null && r.storageQuantityOver > 0) ||
        (r.storageReceivableOver != null && r.storageReceivableOver > 0) ||
        r.hasGrainInStorage) {
      return 'storage';
    }

    // Tickets — quantity, recency, or quality metrics.
    // Customer profile has only ONE ticket tab and it's "Unapplied Tickets" — applied
    // tickets are surfaced inside Contracts (expand a contract row to see its applied
    // tickets). So an "applied tickets" prompt should land on the contracts tab, not
    // the unapplied-tickets tab. Only route to the tickets tab when the prompt is
    // explicitly about unapplied tickets (or is generic about tickets with no
    // applied/unapplied qualifier).
    const isAppliedTicketsQuery = q.includes('applied ticket') && !q.includes('unapplied');
    if (isAppliedTicketsQuery) {
      return 'contracts';
    }
    if (q.includes('ticket') || q.includes('unapplied') ||
        (r.ticketQuantityOver != null && r.ticketQuantityOver > 0) ||
        (r.ticketsInLastDays != null && r.ticketsInLastDays > 0) ||
        r.avgMoistureOver != null || r.avgMoistureUnder != null ||
        r.avgTestWeightOver != null || r.avgTestWeightUnder != null ||
        r.avgProteinOver != null || r.avgProteinUnder != null) {
      return 'tickets';
    }

    // Planting intentions
    if (q.includes('planting') || q.includes('intention') ||
        r.plantingYear != null || r.irrigatedOnly || r.drylandOnly || r.doubleCropOnly ||
        (r.plantingAcresOver != null && r.plantingAcresOver > 0) ||
        r.hasPlantingIntentions) {
      return 'planting';
    }

    // Contracts — explicit signals or contract-flavored query
    if (q.includes('contract') || q.includes('unsigned') || q.includes('expir') ||
        q.includes('unpriced') || q.includes('overdue') ||
        r.noActiveContracts || r.hasUnsignedContracts || r.downHarvestPace ||
        r.hasUnpricedContracts || r.hasOverdueContracts ||
        (r.contractQuantityOver != null && r.contractQuantityOver > 0) ||
        r.contractsExpiringThisMonth || r.multipleCommoditiesContracted ||
        r.hasActiveContracts) {
      return 'contracts';
    }

    return null;
  }

  /** How many earlier notes are currently revealed for this customer. */
  getNoteExpandCount(customerId: number): number {
    return this.expandedNoteCount().get(customerId) ?? 0;
  }

  /** Reveal the next page of earlier notes. Caller passes `totalEarlier` (count of notes
   *  beyond the always-visible most-recent one) so the cap reflects the current display
   *  context (aggregated for the parent vs own-only for split linked sub-rows). */
  expandMoreNotes(customerId: number, totalEarlier: number): void {
    this.expandedNoteCount.update(m => {
      const next = new Map(m);
      const current = next.get(customerId) ?? 0;
      next.set(customerId, Math.min(totalEarlier, current + this.NOTE_PAGE_SIZE));
      return next;
    });
  }

  /** Collapse all earlier notes for this customer back to default (only the most-recent shown). */
  collapseNotes(customerId: number): void {
    this.expandedNoteCount.update(m => {
      const next = new Map(m);
      next.delete(customerId);
      return next;
    });
  }

  /** Active keyword used for inline highlight in matching notes. */
  getActiveNoteKeyword(): string {
    return this.appliedRefinements().noteKeyword?.trim() ?? '';
  }

  toggleLinkedExpand(customerId: number): void {
    let opening = false;
    this.expandedLinkedCustomerIds.update(s => {
      const next = new Set(s);
      if (next.has(customerId)) next.delete(customerId);
      else { next.add(customerId); opening = true; }
      return next;
    });
    // The parent's notes context flips between aggregated and own-only when this toggles,
    // so reset its note pagination. When closing, also drop any pagination state for the
    // linked sub-rows that were visible — those entries are orphaned otherwise and a future
    // re-expansion would reuse a stale count.
    const linkedIds = !opening
      ? (this.linkedProducerInfoByCustomer().get(customerId)?.producers || []).map(p => p.id)
      : [];
    this.expandedNoteCount.update(m => {
      const next = new Map(m);
      next.delete(customerId);
      for (const id of linkedIds) next.delete(id);
      return next;
    });
  }

  isLinkedExpanded(customerId: number): boolean {
    return this.expandedLinkedCustomerIds().has(customerId);
  }

  getInitials(name: string): string {
    const parts = name.split(' ').filter(p => p.length > 0);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    if (parts.length === 1 && parts[0].length >= 2) {
      return parts[0].substring(0, 2).toUpperCase();
    }
    return '??';
  }

  getFormattedLocation(customer: Customer): string {
    if (customer.extendedCity && customer.extendedStateProvince) {
      return `${customer.extendedCity}, ${customer.extendedStateProvince}`;
    }
    if (customer.location && customer.stateProvince) {
      return `${customer.location}, ${customer.stateProvince}`;
    }
    return customer.extendedCity || customer.location || customer.stateProvince || '';
  }

  getLastContactInfo(customerId: number): { text: string; colorClass: string; daysAgo: number } {
    return this.lastContactByCustomer().get(customerId)
      ?? { text: 'Never contacted', colorClass: 'text-scoular-red', daysAgo: Infinity };
  }

  getCustomerCrops(customerId: number): string[] {
    return this.cropsByCustomer().get(customerId) ?? [];
  }
}
