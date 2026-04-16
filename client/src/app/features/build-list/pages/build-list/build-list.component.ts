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
import { expandCommodityAliases } from '@shared/utils/commodity-aliases';

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
    TradeUnitSelectorComponent
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
    if (this.queryText().trim() && this.isProcessing() && this.coreDataLoaded()) {
      untracked(() => {
        // Re-check if the needed data is now available
        const q = this.queryText();
        const ticketsOk = !this.nlqFilterService.queryInvolvesTickets(q) || this._ticketsReady();
        const storageOk = !this.nlqFilterService.queryInvolvesStorage(q) || this.storedGrain().length > 0;
        const notesOk = !this.nlqFilterService.queryInvolvesContact(q) || this.notes().length > 0;
        if (ticketsOk && storageOk && notesOk) {
          this.waitingForTickets.set(false);
          this._applyNlqFilter();
          this.isProcessing.set(false);
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
      r.plantingYear != null, r.irrigatedOnly, r.drylandOnly,
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
      let contracts = contractMap.get(c.sourceCustomerId!) || [];
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
      list = list.filter(c => getContracts(c).some(ct => ct.signed === false));
    }
    if (r.downHarvestPace) {
      list = list.filter(c => this._getCustomerPacingDirection(c) === 'down');
    }
    if (r.hasUnpricedContracts) {
      list = list.filter(c => getContracts(c).some(ct => ct.priceTypeCode === 'U' || ct.priceTypeCode === 'D'));
    }
    if (r.hasOverdueContracts) {
      list = list.filter(c => getContracts(c).some(ct => ct.status === 'Overdue'));
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

    // Contact frequency — index note count per customer
    if (r.contactedOnlyOnce || r.contactedMoreThan5) {
      const noteCountByCustomer = new Map<number, number>();
      for (const n of this.notes()) {
        noteCountByCustomer.set(n.customerId, (noteCountByCustomer.get(n.customerId) || 0) + 1);
      }
      if (r.contactedOnlyOnce) {
        list = list.filter(c => (noteCountByCustomer.get(c.id) || 0) === 1);
      }
      if (r.contactedMoreThan5) {
        list = list.filter(c => (noteCountByCustomer.get(c.id) || 0) > 5);
      }
    }

    // Contact author — check who created the notes
    if (r.contactedByMeOnly || r.contactedBySomeoneElse) {
      const account = this.msalService.instance.getActiveAccount()
        ?? this.msalService.instance.getAllAccounts()[0];
      const myName = (account?.name ?? '').toLowerCase();
      const myUsername = (account?.username ?? '').toLowerCase();
      // Build per-customer: has note by me, has note by someone else
      const noteAuthorship = new Map<number, { byMe: boolean; byOthers: boolean }>();
      for (const n of this.notes()) {
        const author = (n.createdBy || '').toLowerCase();
        const isMine = author.includes(myName) || author.includes(myUsername);
        const entry = noteAuthorship.get(n.customerId) || { byMe: false, byOthers: false };
        if (isMine) entry.byMe = true; else entry.byOthers = true;
        noteAuthorship.set(n.customerId, entry);
      }
      if (r.contactedByMeOnly) {
        list = list.filter(c => {
          const a = noteAuthorship.get(c.id);
          return !!a && a.byMe && !a.byOthers;
        });
      }
      if (r.contactedBySomeoneElse) {
        list = list.filter(c => {
          const a = noteAuthorship.get(c.id);
          return !!a && a.byOthers;
        });
      }
    }

    // Notes content
    if (r.hasPinnedNotes) {
      const pinnedCustomerIds = new Set<number>(
        this.notes().filter(n => n.isPinned).map(n => n.customerId)
      );
      list = list.filter(c => pinnedCustomerIds.has(c.id));
    }
    if (r.noteKeyword?.trim()) {
      const kw = r.noteKeyword.trim().toLowerCase();
      // Index which customerCodes have notes matching the keyword
      const matchingCodes = new Set<string>();
      for (const n of this.notes()) {
        if ((n.content || '').toLowerCase().includes(kw) && n.customerCode) {
          matchingCodes.add(n.customerCode);
        }
      }
      // Build incoming links map (bidirectional — same as contact history)
      const incomingLinks = new Map<string, Set<string>>();
      for (const c of this.customers()) {
        if (!c.sourceCustomerId) continue;
        for (const linkedCode of (c.linkedProducerIds || [])) {
          if (!incomingLinks.has(linkedCode)) incomingLinks.set(linkedCode, new Set());
          incomingLinks.get(linkedCode)!.add(c.sourceCustomerId);
        }
      }
      // Match customers directly + via linked producers (bidirectional)
      list = list.filter(c => {
        const allCodes = new Set<string>();
        if (c.sourceCustomerId) allCodes.add(c.sourceCustomerId);
        // Outgoing links (I link to them)
        for (const linkedCode of (c.linkedProducerIds || [])) allCodes.add(linkedCode);
        // Incoming links (they link to me)
        for (const inCode of (incomingLinks.get(c.sourceCustomerId || '') || [])) allCodes.add(inCode);
        // Check if any code in the network has a matching note
        for (const code of allCodes) {
          if (matchingCodes.has(code)) return true;
        }
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
        const contracts = contractMap.get(c.sourceCustomerId!) || [];
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
      list = list.filter(c => ticketCustomers.has(c.sourceCustomerId!));
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
        if (c.sourceCustomerId) codeToId.set(c.sourceCustomerId, c.id);
      }
      // Scope tickets to selected crops when a crop filter is active
      const scopedTickets = selectedCrops.size > 0
        ? this.tickets().filter(t => t.productCode && this._matchesCropFilter(t.productCode, selectedCrops))
        : this.tickets();

      if (r.ticketQuantityOver != null && r.ticketQuantityOver > 0) {
        const customerTotals = new Map<number, number>();
        for (const t of scopedTickets) {
          if (!t.customerCode) continue;
          const custId = codeToId.get(t.customerCode);
          if (custId != null) customerTotals.set(custId, (customerTotals.get(custId) || 0) + (t.netWeight || 0));
        }
        list = list.filter(c => (customerTotals.get(c.id) || 0) > r.ticketQuantityOver!);
      }
      if (r.ticketsInLastDays != null && r.ticketsInLastDays > 0) {
        const cutoff = Date.now() - r.ticketsInLastDays * 86400000;
        const recentCustomers = new Set<string>();
        for (const t of scopedTickets) {
          if (!t.customerCode || !t.date) continue;
          if (new Date(t.date).getTime() >= cutoff) recentCustomers.add(t.customerCode);
        }
        list = list.filter(c => recentCustomers.has(c.sourceCustomerId!));
      }
      // Quality averages — scoped to selected crops
      if (r.avgMoistureOver != null || r.avgMoistureUnder != null ||
          r.avgTestWeightOver != null || r.avgTestWeightUnder != null ||
          r.avgProteinOver != null || r.avgProteinUnder != null) {
        const customerQuality = new Map<number, { moistureSum: number; moistureCount: number; twSum: number; twCount: number; proteinSum: number; proteinCount: number }>();
        for (const t of scopedTickets) {
          if (!t.customerCode) continue;
          const custId = codeToId.get(t.customerCode);
          if (custId == null) continue;
          let entry = customerQuality.get(custId);
          if (!entry) { entry = { moistureSum: 0, moistureCount: 0, twSum: 0, twCount: 0, proteinSum: 0, proteinCount: 0 }; customerQuality.set(custId, entry); }
          if (t.moisture != null) { entry.moistureSum += t.moisture; entry.moistureCount++; }
          if (t.testWeight != null) { entry.twSum += t.testWeight; entry.twCount++; }
          if (t.proteinPercent != null) { entry.proteinSum += t.proteinPercent; entry.proteinCount++; }
        }
        list = list.filter(c => {
          const q = customerQuality.get(c.id);
          if (!q) return false;
          if (r.avgMoistureOver != null && (q.moistureCount === 0 || q.moistureSum / q.moistureCount <= r.avgMoistureOver)) return false;
          if (r.avgMoistureUnder != null && (q.moistureCount === 0 || q.moistureSum / q.moistureCount >= r.avgMoistureUnder)) return false;
          if (r.avgTestWeightOver != null && (q.twCount === 0 || q.twSum / q.twCount <= r.avgTestWeightOver)) return false;
          if (r.avgTestWeightUnder != null && (q.twCount === 0 || q.twSum / q.twCount >= r.avgTestWeightUnder)) return false;
          if (r.avgProteinOver != null && (q.proteinCount === 0 || q.proteinSum / q.proteinCount <= r.avgProteinOver)) return false;
          if (r.avgProteinUnder != null && (q.proteinCount === 0 || q.proteinSum / q.proteinCount >= r.avgProteinUnder)) return false;
          return true;
        });
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
    if (r.plantingAcresOver != null && r.plantingAcresOver > 0) {
      const customerAcres = new Map<number, number>();
      for (const p of this.plantingIntentions()) {
        customerAcres.set(p.customerId, (customerAcres.get(p.customerId) || 0) + p.acres);
      }
      list = list.filter(c => (customerAcres.get(c.id) || 0) > r.plantingAcresOver!);
    }

    if (selectedCrops.size > 0) {
      list = list.filter(c => (c.commodities ?? []).some(crop => selectedCrops.has(crop.trim().toLowerCase())));
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
    return list;
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
  showRefinePanel = signal(false);
  pendingRefinements = signal<RefinementFilters>({});
  appliedRefinements = signal<RefinementFilters>({});
  notContactedDaysInput = signal('');
  matchedPatterns = signal<string[]>([]);

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
    unsigned_contract: 'Unsigned contracts', negative_pacing: 'Behind on pacing',
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

  /** Open contracts only — used by refinement filters (no active, unsigned, etc.). */
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

    // Treat bare ISO strings as UTC — API stores DateTime.UtcNow without Z suffix.
    const parseUtc = (ts: string | Date) => {
      const raw = typeof ts === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts + 'Z' : ts;
      return new Date(raw).getTime();
    };

    // Index notes by customerCode (source customer ID) — same as home page
    const notesByCode = new Map<string, { time: number }>();
    for (const n of this.notes()) {
      if (!n.customerCode) continue;
      const time = parseUtc(n.createdAt);
      const existing = notesByCode.get(n.customerCode);
      if (!existing || time > existing.time) {
        notesByCode.set(n.customerCode, { time });
      }
    }

    // Build bidirectional linked-producer map (outgoing + incoming)
    const allCustomers = this.customers();
    const linkedById = new Map<number, string[]>();
    for (const c of allCustomers) {
      if (c.linkedProducerIds?.length) linkedById.set(c.id, c.linkedProducerIds);
    }
    const incomingCodeLinks = new Map<string, Set<string>>();
    for (const c of allCustomers) {
      if (!c.sourceCustomerId) continue;
      for (const linkedCode of (c.linkedProducerIds || [])) {
        if (!incomingCodeLinks.has(linkedCode)) incomingCodeLinks.set(linkedCode, new Set());
        incomingCodeLinks.get(linkedCode)!.add(c.sourceCustomerId);
      }
    }

    // Resolve latest note time per customer including linked producers
    const latestNotes = new Map<number, { time: number }>();
    for (const customer of allCustomers) {
      const freshLinked = linkedById.get(customer.id) ?? customer.linkedProducerIds ?? [];
      const allCodes = new Set<string>();
      if (customer.sourceCustomerId) allCodes.add(customer.sourceCustomerId);
      for (const linkedCode of freshLinked) allCodes.add(linkedCode);
      for (const incomingCode of (incomingCodeLinks.get(customer.sourceCustomerId || '') || new Set<string>())) {
        allCodes.add(incomingCode);
      }
      let latestTime = 0;
      for (const code of allCodes) {
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
      const contractCrops = customer.sourceCustomerId
        ? [...new Set(
            (contractMap.get(customer.sourceCustomerId) || [])
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
    return [...cats].sort();
  });

  /** Which refine filter sections are visible based on the selected query's category. */
  readonly showContractFilters = computed(() => {
    const cat = this.selectedLibraryQuery()?.category;
    return cat === 'Contracts';
  });
  readonly showContactFilters = computed(() => {
    const cat = this.selectedLibraryQuery()?.category;
    return cat === 'Contacts' || cat === 'Notes';
  });
  /** Filters that are redundant given the selected query — hide them from the UI. */
  readonly hiddenFilters = computed<Set<string>>(() => {
    const q = (this.selectedLibraryQuery()?.queryText || '').toLowerCase();
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
    if (q.includes('corn') && q.includes('planting')) hidden.add('plantingCrop');
    if (q.includes('wheat') && q.includes('planting')) hidden.add('plantingCrop');
    if (q.includes('in storage') || q.includes('stored')) hidden.add('hasGrainInStorage');
    if (/stored.*over.*\d+\s*days|storage.*over.*\d+\s*days/.test(q)) hidden.add('storageDaysOver');
    if (q.includes('unapplied') || q.includes('applied ticket')) hidden.add('hasDeliveriesThisYear');
    return hidden;
  });

  readonly showTicketFilters = computed(() => {
    const cat = this.selectedLibraryQuery()?.category;
    return cat === 'Tickets';
  });
  readonly showStorageFilters = computed(() => {
    const cat = this.selectedLibraryQuery()?.category;
    return cat === 'Storage';
  });
  readonly showPlantingFilters = computed(() => {
    const cat = this.selectedLibraryQuery()?.category;
    return cat === 'Planting';
  });
  readonly showGeneralFilters = computed(() => {
    const cat = this.selectedLibraryQuery()?.category;
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

    // Load query library
    this.apiService.getQueryLibrary().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (items) => { this.queryLibrary.set(items); this.queryLibraryLoaded.set(true); },
      error: () => { this.queryLibraryLoaded.set(true); this.toastService.error('Failed to load query library'); }
    });

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
          selectedLibraryQuery: this.selectedLibraryQuery()
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
      contracts: this.apiService.getContracts(tuParam).pipe(catchError(() => of([] as Contract[]))),
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
        this.toastService.error('Failed to load data');
      }
    });

    // Tickets load in background — processQuery waits for them only if the query needs tickets
    this.apiService.getTickets(tuParam).pipe(
      timeout(60000),
      catchError(() => of([] as Ticket[])),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(tickets => {
      if (requestId !== this._loadRequestId) return;
      this.tickets.set(tickets);
      this.appState.setTickets(tickets);
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

    // All other data (notes, contracts, storage, planting) comes from the forkJoin
    // which completes before coreDataLoaded is set. Run the NLQ immediately.
    this.waitingForTickets.set(false);
    this._applyNlqFilter();
    this.isProcessing.set(false);
  }

  /** Fetches fresh data for specific trade units and runs the NLQ filter. */
  private _fetchAndFilter(tradeUnits: string[]): void {
    const queryGen = this._queryGenId; // Capture to detect if a newer query supersedes this one

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
      contracts: this.apiService.getContracts(tuParam).pipe(catchError(() => of([] as Contract[]))),
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
    const context: NlqFilterContext = {
      customers: this.customers(),
      contracts: this.contracts(),
      tickets: this.tickets(),
      notes: this.notes(),
      plantingIntentions: this.plantingIntentions(),
      storedGrain: this.storedGrain(),
      commodities: this.appState.commodities()
    };
    const resolvedQuery = this._resolveUserReferences(this.queryText());
    const result = this.nlqFilterService.parseAndFilter(resolvedQuery, context);
    this.detectedState.set(result.detectedState);
    this.matchedPatterns.set(result.matchedPatterns);
    this.hasGenerated.set(true);
    // Don't show "no match" if tickets are still loading and the query needs them
    const ticketsPending = this.nlqFilterService.queryInvolvesTickets(this.queryText()) && !this._ticketsReady();
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
          (this._contractsByCustomer().get(c.sourceCustomerId!) || []).length > 0
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
    if (this.loading() || this.isProcessing()) return;
    this.usageTracking.postClickEvent('interaction', 'build-a-list', 'saved-list-loaded', list.id.toString());
    this.activeSavedList.set(list);
    this.queryText.set(list.query);
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
    // Open the panel automatically so the user can see the active filters
    if (this.hasAnyRefinement(this.appliedRefinements())) {
      this.showRefinePanel.set(true);
    }
    if (this._pendingIncludedIds.length > 0 || this.manuallyExcludedCustomerIds().size > 0) {
      this.showManageMembersPanel.set(true);
    }
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

    // Immediately filter current results for exclude candidates (client-side, instant)
    const lower = term.trim().toLowerCase();
    const excludedIds = this.manuallyExcludedCustomerIds();
    this.memberInResultsMatches.set(
      this.displayedCustomers()
        .filter(c =>
          !excludedIds.has(c.id) &&
          (c.name.toLowerCase().includes(lower) ||
           (c.sourceCustomerId || '').toLowerCase().includes(lower) ||
           (c.farm || '').toLowerCase().includes(lower))
        )
        .slice(0, 5)
    );

    // Debounced API search for add candidates
    this.memberSearchLoading.set(true);
    this._memberSearchTimeout = setTimeout(() => {
      const tus = this.effectiveTradeUnits();
      this.apiService.searchCustomers(term, tus.length > 0 ? tus : undefined)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (results) => {
            const includedIds = new Set(this.manuallyIncludedCustomers().map(c => c.id));
            const displayedIds = new Set(this.displayedCustomers().map(c => c.id));
            this.memberSearchResults.set(
              results.filter(c => !includedIds.has(c.id) && !displayedIds.has(c.id)).slice(0, 5)
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
    // Clear search
    this.memberSearchTerm.set('');
    this.memberSearchResults.set([]);
    this.memberInResultsMatches.set([]);
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
    // Clear search so user can immediately search for another
    this.memberSearchTerm.set('');
    this.memberSearchResults.set([]);
    this.memberInResultsMatches.set([]);
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
    const customerContracts = this._contractsByCustomer().get(customer.sourceCustomerId!) || [];
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
          const custContracts = contractsByCustomer.get(c.sourceCustomerId!) || [];
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
          const custContracts = contractsByCustomer.get(c.sourceCustomerId!) || [];
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
          const custContracts = contractsByCustomer.get(c.sourceCustomerId!) || [];
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
      filters.plantingYear != null || filters.irrigatedOnly || filters.drylandOnly ||
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
    const payload = {
      name: this.newListName(),
      query: this.queryText(),
      tradeUnits: tradeUnits.length > 0 ? tradeUnits.join(',') : undefined,
      filters: this.activeRefinementCount() > 0 ? { ...this.appliedRefinements() } : undefined,
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
    this.router.navigate(['/'], { queryParams: { customerId: customer.id } });
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
