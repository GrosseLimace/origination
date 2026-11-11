import { ChangeDetectionStrategy, Component, forwardRef, inject, signal, computed, DestroyRef, effect, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { applyAdoptedCustomerId } from './adopt-assigned-customer';
import { finalize, takeUntil } from 'rxjs/operators';
import { alreadyShown } from '@core/http/shown-errors';
import { ApiService } from '@core/services/api.service';
import { CustomerStore } from '../../data-access/customer.store';
import { CustomersApiService } from '../../data-access/customers-api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer, ProducerDetails } from '@models';
import { CustomerListComponent } from '../../components/customer-list/customer-list.component';
import { CustomerProfileComponent } from '../../components/customer-profile/customer-profile.component';
import { CustomerSlotComponent } from '@core/modules/customer-slot.component';
import { commodityCodesFrom } from '@shared/utils/commodity-codes';
import { HomeBackgroundFailures } from './home-background-failures';
import { HomePageState } from './home-page.state';
import { homeScreenSource } from './home-screen-source';
import { LinkedProducersStore } from '../../data-access/linked-producers.store';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { CUSTOMER_SCREEN_SOURCE, SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { SelectedProducerActivity } from '@core/context/selected-producer-activity';
import { SelectedProducerProduction } from '@core/context/selected-producer-production';
import { SelectedProducerEngagement } from '@core/context/selected-producer-engagement';
import { ProducerEdit, ProducerEditing } from '@core/context/producer-editing';
import { ProducerProfiles } from '@core/context/producer-profiles';
import { profileLinkedIds } from '@shared/utils/producer-profile';
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CustomerListComponent,
    CustomerProfileComponent,
    CustomerSlotComponent
  ],
  templateUrl: './home.component.html',
  // Page-scoped state and behaviour, one instance per visit to the page. SelectedCustomerContext is the customer
  // the page shows, for the panels and tabs the modules add to it; their contracts, tickets and pricing
  // (SelectedProducerActivity), their production (SelectedProducerProduction) and their notes and the user's follow-ups
  // (SelectedProducerEngagement) are the modules' own, which the page tells who is selected.
  providers: [
    HomePageState, HomeBackgroundFailures, SelectedCustomerContext,
    { provide: CUSTOMER_SCREEN_SOURCE, useFactory: homeScreenSource },
    // The Edit Producer Details dialog saves through the page, which keeps its lists up to date as the save goes.
    { provide: ProducerEditing, useExisting: forwardRef(() => HomeComponent) },
  ],
  // The template reads only signals, computeds, getLinkedGroup() (which reads signals) and two
  // constant flags, and every async writer (API callbacks, effects, the resize listener, the
  // deep-link poll) writes signals - home.component.render.spec.ts renders each of those paths.
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent implements ProducerEditing {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly customerStore = inject(CustomerStore);
  private readonly customersApi = inject(CustomersApiService);
  private readonly tradeUnitContext = inject(TradeUnitContext);
  private readonly toastService = inject(ToastService);
  private readonly usageTracking = inject(UsageTrackingService);
  private readonly destroyRef = inject(DestroyRef);
  /** Every producer's details: the Producers module keeps them, and this page lays them over its producers. */
  private readonly producerProfiles = inject(ProducerProfiles);

  /** Throttled toast + dev log for background loads that fail (see HomeBackgroundFailures). */
  private readonly backgroundFailures = inject(HomeBackgroundFailures);
  /** Signals shared with the page-scoped stores (see HomePageState). */
  private readonly page = inject(HomePageState);
  /** The producers linked to the trade units' customers from outside them, the walk that fetches them, and each
   *  producer's linked group (see LinkedProducersStore). */
  private readonly linked = inject(LinkedProducersStore);
  /** The selected producer's contracts, tickets and pricing lines: the Contracts module's, which the page tells who is
   *  selected. */
  private readonly producerActivity = inject(SelectedProducerActivity);
  /** The selected producer's planting intentions, stored grain, DP contracts and crop year: the Producers module's,
   *  which the page tells who is selected. */
  private readonly production = inject(SelectedProducerProduction);
  /** The selected producer's notes, with their linked group's, and the user's follow-ups for them: the Engagement
   *  module's, which the page tells who is selected. */
  private readonly engagement = inject(SelectedProducerEngagement);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly _resizeHandler = () => this._checkMobile();
  private _isLoading = false;
  private _customerRequestId = 0;
  /** Cancels the prior selection's in-flight requests (see HomePageState.cancelSelection$). */
  private readonly _cancelSelection$ = this.page.cancelSelection$;
  /** How long a trade-unit save runs before the page says it is still working. */
  static readonly SLOW_TRADE_UNIT_SAVE_MS = 15_000;


  // Public signals — template binds directly to these
  readonly customers = this.page.customers;

  readonly selectedCustomer = this.page.selectedCustomer;
  /** True when the open-contracts table has its extra columns expanded — drops the Notes
   *  sidebar below the profile so the table gets the full page width. */
  readonly contractsWide = signal(false);
  /** Where a deep link asked the profile to open (see HomePageState); the screen's pieces read it through SelectedCustomerContext. */
  readonly pendingContractId = this.page.pendingContractId;
  readonly pendingTab = this.page.pendingTab;
  readonly pendingPlantingYear = this.page.pendingPlantingYear;
  readonly pendingTicketCrop = this.page.pendingTicketCrop;
  readonly selectedTradeUnits = this.page.selectedTradeUnits;
  /** The selected producer's contracts, tickets and pricing lines, with their loading and error state (the Contracts
   *  module's). */
  readonly customerContracts = this.producerActivity.contracts;
  readonly customerTickets = this.producerActivity.tickets;
  readonly customerPricingLines = this.producerActivity.pricingLines;
  readonly isLoadingContracts = this.producerActivity.isLoadingContracts;
  readonly contractsLoadError = this.producerActivity.contractsLoadError;
  readonly isLoadingUnappliedTickets = this.producerActivity.isLoadingTickets;
  readonly ticketsLoadError = this.producerActivity.ticketsLoadError;
  readonly pricingLinesLoadError = this.producerActivity.pricingLinesLoadError;
  readonly isLoadingPricingLines = this.producerActivity.isLoadingPricingLines;

  /** Producer ids whose trade-unit save (PUT .../trade-units) is still running. */
  private readonly _tradeUnitSavesInFlight = signal<ReadonlySet<number>>(new Set());
  /** The selected producer's trade-unit save is still running - the edit dialog keeps Save off meanwhile. */
  readonly isSavingTradeUnits = computed(() => {
    const sel = this.selectedCustomer();
    return !!sel && this._tradeUnitSavesInFlight().has(sel.id);
  });

  // ── ProducerEditing, for the Edit Producer Details dialog ──
  /** The roster the dialog's link search offers, and the trade units it is from. */
  readonly producers = this.customers;
  readonly producersTradeUnits = this.selectedTradeUnits;
  readonly saving = this.isSavingTradeUnits;
  save(edit: ProducerEdit): void {
    this.handleSaveCustomer(edit);
  }

  readonly isMobile = signal(false);
  readonly loading = signal(false);


  // Track last trade unit key to avoid duplicate loads triggered by the effect
  private _lastTradeUnitKey = '';
  private _initialized = false;

  constructor() {
    this._checkMobile();
    window.addEventListener('resize', this._resizeHandler);
    this.destroyRef.onDestroy(() => window.removeEventListener('resize', this._resizeHandler));

    this._restoreStateFromService();
    this._loadProducerDetails();

    // Only fetch from API if appState has no cached customers — otherwise use the cache.
    // This prevents a full reload every time the user navigates back from another page.
    if (this.customerStore.customers().length === 0) {
      this._loadAllData(this.selectedTradeUnits());
    }
    this._lastTradeUnitKey = [...this.selectedTradeUnits()].sort().join(',');
    this._initialized = true;

    // React to global trade unit changes made via TradeUnitSelectorComponent
    effect(() => {
      const tradeUnits = this.tradeUnitContext.selectedTradeUnits();
      if (!this._initialized) return;
      const key = [...tradeUnits].sort().join(',');
      if (key === this._lastTradeUnitKey) return;
      this._lastTradeUnitKey = key;
      untracked(() => this._onTradeUnitsChanged(tradeUnits));
    });

    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const customerId = params['customerId'];
      if (customerId) {
        const contractId = params['contractId'];
        this.pendingContractId.set(contractId ? parseInt(contractId, 10) : null);
        this.pendingTab.set(params['tab'] ?? null);
        this.pendingTicketCrop.set(params['ticketCrop'] ?? null);
        const yearParam = params['year'];
        const yearNum = yearParam ? parseInt(yearParam, 10) : NaN;
        this.pendingPlantingYear.set(Number.isFinite(yearNum) && yearNum > 0 ? yearNum : null);
        this._selectCustomerById(customerId);
      }
    });
  }

  private _restoreStateFromService(): void {
    this.selectedTradeUnits.set(this.tradeUnitContext.selectedTradeUnits());

    const stateCustomers = this.customerStore.customers();
    if (stateCustomers.length > 0) {
      this.customers.set(stateCustomers);

      const stateSelectedCustomer = this.appState.selectedCustomer();
      if (stateSelectedCustomer) {
        this.selectedCustomer.set(stateSelectedCustomer);
        // Their contracts, tickets and pricing lines show from what Contracts read, refreshed if they have aged.
        this.producerActivity.select(stateSelectedCustomer);
        // Their planting intentions are read again on the way back, as they may have changed elsewhere; their stored
        // grain and DP show from what was read.
        this.production.select(stateSelectedCustomer, { reread: true });
        // Their notes and the user's follow-ups show as Engagement kept them.
        this.engagement.select(stateSelectedCustomer);
      }
    }
  }

  private _checkMobile(): void {
    this.isMobile.set(window.innerWidth < 1024);
  }

  private _selectCustomerById(customerId: string): void {
    const customerIdNum = parseInt(customerId, 10);
    const customer = this.customers().find(c => c.id === customerIdNum);
    if (customer) {
      this.handleSelectCustomer(customer, true); // fromDeepLink=true, preserve pending state
    } else {
      const checkInterval = setInterval(() => {
        const c = this.customers().find(cust => cust.id === customerIdNum);
        if (c) {
          clearInterval(checkInterval);
          this.handleSelectCustomer(c, true); // fromDeepLink=true
        }
      }, 100);
      setTimeout(() => clearInterval(checkInterval), 5000);
    }
  }

  private _loadAllData(tradeUnits?: string[]): void {
    // Increment request ID so any in-flight customer request from a previous
    // trade unit selection is ignored when it eventually resolves.
    const requestId = ++this._customerRequestId;
    this._isLoading = true;
    this.loading.set(true);

    this.customersApi.getCustomers(tradeUnits).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        // Discard result if a newer request has already been issued.
        if (requestId !== this._customerRequestId) return;
        const list = data ?? [];
        this.customers.set(list);
        this.customerStore.setCustomers(list);
        this.customerStore.setCustomersLoadFailed(false);
        this.loading.set(false);
        this._isLoading = false;

        // The selected producer's details, if already read (by the preload, or this page's read below when it landed
        // first), may link them to producers not walked yet. A read still running does the same when it lands.
        this._afterProducerDetailsLanded(this.producerProfiles.profiles().keys());
      },
      error: () => {
        if (requestId !== this._customerRequestId) return;
        // The producer list shows "Couldn't load producers" from this rather than "No producers found".
        this.customerStore.setCustomersLoadFailed(true);
        this.loading.set(false);
        this._isLoading = false;
      }
    });

    // The trade units' contracts, tickets, planting, notes and the rest are the modules' preloads' to read.
  }

  /** Reads every producer's details again, as each visit to the page does; ProducerProfiles keeps them, and every
   *  piece of the screen reads them from there. */
  private _loadProducerDetails(): void {
    this.producerProfiles.load().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (details) => {
        if (this.customers().length > 0) this._afterProducerDetailsLanded(details.map(d => d.customerId));
      },
      error: (err) => this.backgroundFailures.report('load producer details', err)
    });
  }

  /**
   * Some producers' details have landed in ProducerProfiles. If the selected producer's are among them, their links may
   * have changed: walk them again. Engagement reads the notes of the group as it grows.
   */
  private _afterProducerDetailsLanded(customerIds: Iterable<number>): void {
    const sel = this.selectedCustomer();
    if (!sel || !new Set(customerIds).has(sel.id)) return;
    this._fetchMissingLinkedProducers(sel);
  }

  handleClearSelection(): void {
    this.selectedCustomer.set(null);
    this.appState.selectCustomer(null);
    this.producerActivity.select(null);
    this.production.select(null);
    this.engagement.select(null);
    this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  private _onTradeUnitsChanged(tradeUnits: string[]): void {
    this.selectedTradeUnits.set(tradeUnits);
    this.selectedCustomer.set(null);
    this.appState.selectCustomer(null);
    // The producers linked from outside the trade units, and the walks that found them, were for the last ones.
    this.linked.clear();
    // Clear the stale customer list immediately so the old roster doesn't show while the
    // new API calls are in flight.
    this.customers.set([]);
    this.customerStore.setCustomers([]);
    // The Contracts, Producers and Engagement modules forget their own reads of the producers on a trade-unit change, so
    // re-clicking a producer the new trade units still cover reads them again for the new scope (notes included, which
    // picks up those other reps added since). Cancel what is still being read for the producer (their details and the
    // linked walk here; the modules' own reads with their selection), and drop the modules' selection, so nothing lands
    // after the new trade units have loaded and no loading state is left waiting on it.
    this._cancelSelection$.next();
    this.producerActivity.select(null);
    this.production.select(null);
    this.engagement.select(null);
    // Reset loading flag so an explicit user selection is never blocked by a
    // background load that may still be in-flight.
    this._isLoading = false;
    // With none selected the modules' preloads don't run; the list's last-contacted badges read the summary, which covers
    // every trade unit, themselves.
    if (tradeUnits && tradeUnits.length > 0) this._loadAllData(tradeUnits);
  }

  handleSelectCustomer(customer: Customer, fromDeepLink = false): void {
    // Cancel everything still in flight from the prior customer selection so the
    // browser's connection pool isn't blocked by stale linked-producer / notes /
    // planting calls when the user clicks through producers quickly.
    this._cancelSelection$.next();
    // Reset navigation context when user manually selects (but NOT when coming from a deep link)
    if (!fromDeepLink) {
      this.pendingContractId.set(null);
      this.pendingTab.set(null);
      this.pendingTicketCrop.set(null);
    }
    this.usageTracking.trackProfileOpened(customer.id.toString());
    const pd = this.producerProfiles.profileOf(customer.id);
    if (pd) {
      this._refreshSelectedProducerDetails(customer.id, pd);
    } else {
      this.apiService.getProducerDetails(customer.id).pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (details) => {
          this.producerProfiles.put(details);
          // Their links may have just arrived, so the (possibly expanded) group's notes are cached and the panel
          // shows the full history.
          this._afterProducerDetailsLanded([details.customerId]);
        },
        error: (err) => this.backgroundFailures.report('refresh producer details', err)
      });
    }

    this.selectedCustomer.set(customer);
    this.appState.selectCustomer(customer);
    this.producerActivity.select(customer);
    // Their planting intentions, from what was read before; their stored grain and DP; and the crop year a deep link
    // asked for, else the newest.
    this.production.select(customer, { plantingYear: this.pendingPlantingYear() });
    // Their notes and their linked group's, as the group becomes known, and the user's follow-ups for them.
    this.engagement.select(customer);
    this._fetchMissingLinkedProducers(customer);
  }

  /**
   * Re-reads the clicked producer's details in the background and applies them if they changed since
   * the page loaded them — e.g. a teammate added grain on farm (QA, RUNDMAP, 2026-10-12: the list showed
   * none while Build a List, which reads fresh, showed 50,000 bu). The profile already shows the cached
   * copy, so this only matters when something changed; then everything that reads ProducerProfiles updates.
   */
  private _refreshSelectedProducerDetails(customerId: number, cached: ProducerDetails): void {
    this.apiService.getProducerDetails(customerId).pipe(takeUntil(this._cancelSelection$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (details) => {
        if (JSON.stringify(details) === JSON.stringify(cached)) return;
        this.producerProfiles.put(details);
        this._afterProducerDetailsLanded([details.customerId]);
      },
      error: (err) => this.backgroundFailures.report('refresh producer details', err)
    });
  }

  /** Fetches every producer transitively linked to `customer` that isn't loaded yet (see LinkedProducersStore), until
   *  the next selection. */
  private _fetchMissingLinkedProducers(customer: Customer): void {
    this.linked.fetchMissingLinkedProducers(customer, this._cancelSelection$);
  }

  private _propagatePrimaryContact(linkedCustomer: Customer, primary: { name: string; phone?: string; email?: string }): void {
    const existingPd = this.producerProfiles.profileOf(linkedCustomer.id);
    // Skip if the linked producer already has a primary contact
    if (existingPd?.primaryContact) return;

    this.apiService.saveProducerDetails(linkedCustomer.id, {
      scoularId: linkedCustomer.scoularId || null,
      customerName: linkedCustomer.name,
      totalAcres: existingPd?.totalAcres ?? null,
      primaryContact: primary.name,
      primaryPhone: primary.phone ?? null,
      commodities: existingPd?.commodities ?? null,
      linkedProducerIds: existingPd?.linkedProducerIds || null,
      // grainOnFarm intentionally omitted — this save isn't editing grain on farm, and the server
      // preserves the existing rows when it is absent (a cached copy could be older than a teammate's edit).
      // Preserve any existing contact rows; otherwise seed the full primary row (name + phone +
      // email) so the linked producer gets the same contact card (never wipes rows).
      contacts: existingPd?.contacts && existingPd.contacts.length > 0
        ? existingPd.contacts.map(c => ({ name: c.name, phone: c.phone, email: c.email, isPrimary: c.isPrimary }))
        : [{ name: primary.name, phone: primary.phone, email: primary.email, isPrimary: true }]
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      // The linked producer's new contact shows wherever their details are read.
      next: (pd) => this.producerProfiles.put(pd),
      error: (err) => this.backgroundFailures.report('update the linked producer contact', err)
    });
  }

  /** Warms one producer's contracts and tickets on hover so the click renders from memory (the Contracts module's). */
  handlePrefetchCustomer(customer: Customer): void {
    this.producerActivity.prefetch(customer);
  }

  /** Save handler for the edit dialog. Trade-unit assignment (if any) runs FIRST — for an
   *  onboarding candidate that PUT inserts them into dbo.Customer, which the ProducerDetails
   *  save then depends on (FK). Existing customers with no TU change skip straight to the
   *  details save, unchanged. */
  handleSaveCustomer(data: ProducerEdit): void {
    // Only call the trade-unit reconcile when the dialog flagged it safe + meaningful
    // (onboarding a candidate, or the manual TU set actually changed). A pure details edit
    // skips it entirely, and a failed TU-load never reconciles (so manual TUs can't be wiped).
    if (data.reconcileTradeUnits) {
      // The dialog closes at once, so a slow save looked like a dead one: nothing changed on screen, the
      // rep saved again, and the browser eventually reported a failure for a save the server went on to
      // finish (PROD 2026-10-28, four saves of one onboarding). Mark it busy, and say so if it runs long.
      const savingId = data.customerId;
      this._tradeUnitSavesInFlight.update(ids => new Set(ids).add(savingId));
      const slowNotice = setTimeout(
        () => this.toastService.info('Still saving trade units — this can take up to a minute. No need to save again.', 8000),
        HomeComponent.SLOW_TRADE_UNIT_SAVE_MS);
      this.customersApi.assignTradeUnits(data.customerId, data.tradeUnitCodes ?? [], data.scoularId).pipe(
        finalize(() => {
          clearTimeout(slowNotice);
          this._tradeUnitSavesInFlight.update(ids => {
            const next = new Set(ids);
            next.delete(savingId);
            return next;
          });
        })
      ).subscribe({
        next: (customer) => {
          // The server may have adopted an existing row for the same producer (matched by ScoularId);
          // everything below must use the id it actually wrote the trade units to.
          const effective = applyAdoptedCustomerId(data, customer);
          // A candidate from the CTRM search carries a negative placeholder id; the server mints the
          // real one, so a changed id there is a brand-new row, not an adoption.
          const minted = data.customerId < 0;
          const adopted = !minted && effective.customerId !== data.customerId;
          const sel = this.selectedCustomer();
          if (adopted) {
            // Select the returned record first so _saveProducerDetailsAndLinks can find it (the list may not hold it).
            this.toastService.success('That producer was already in the Workbench — trade units were added to the existing record.');
            this.selectedCustomer.set({ ...customer, isManual: true, isOnboardCandidate: false });
          } else if (sel?.id === data.customerId && sel.isOnboardCandidate) {
            // A brand-new onboarding: they're now in dbo.Customer — clear the candidate flag on
            // the selected record so we stay on this producer and notes / details unlock. The
            // returned record carries the real id (minted for a CTRM candidate).
            this.toastService.success('Producer added and trade units assigned. Select that trade unit or group to see them.');
            this.selectedCustomer.set({ ...sel, ...customer, isManual: true, isOnboardCandidate: false });
          }
          this._saveProducerDetailsAndLinks(effective);
          this.production.movePlantingIntentions(effective.customerId, effective.intentionMoves ?? []);
        },
        error: err => { if (!alreadyShown(err)) this.toastService.error('Failed to update trade units'); }
      });
    } else {
      this._saveProducerDetailsAndLinks(data);
      this.production.movePlantingIntentions(data.customerId, data.intentionMoves ?? []);
    }
  }

  private _saveProducerDetailsAndLinks(data: { customerId: number; acres: number; commodities: string[]; primaryContact: string; primaryPhone: string; contacts: { name: string; phone?: string; email?: string; isPrimary: boolean }[]; binSites: { siteKey: string; name: string; latitude?: number; longitude?: number; capacity?: number }[]; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean; grainOnFarm: { binSiteKey?: string; commodityCode: string; bushelsOnHand?: number; bushelsSold?: number; targetBushels?: number; lastBid?: number; grade?: string }[] }): void {
    const customers = this.customers();
    const sel = this.selectedCustomer();
    const customer = customers.find(c => c.id === data.customerId)
      || (sel?.id === data.customerId ? sel : null);
    if (!customer) return;

    const allCommodities = [...new Set([
      ...commodityCodesFrom(this.customerTickets(), this.customerContracts()), ...data.commodities
    ])].sort();

    const optimisticContacts = data.contacts.map((c, i) => ({ ...c, sortOrder: i }));
    const optimisticBinSites = data.binSites.map((b, i) => ({ ...b, sortOrder: i }));
    // The profile shows each grain row's site by name; fill it in from the sites being saved.
    const siteNames = new Map(data.binSites.map(b => [b.siteKey, b.name]));
    const optimisticGrain = data.grainOnFarm.map(g => ({ ...g, binSiteName: g.binSiteKey ? siteNames.get(g.binSiteKey) ?? null : null }));
    // eSign is the customer's own; everything else the dialog edits is the producer's details, put in below.
    const updated: Customer = { ...customer, eSignEnabled: data.eSignEnabled };

    const savedCommodities = allCommodities.length > 0 ? allCommodities.join(',') : null;
    const savedLinkedIds = data.linkedProducerIds.length > 0 ? data.linkedProducerIds.join(',') : null;
    const savePayload = {
      scoularId: customer.scoularId || null,
      customerName: customer.name,
      totalAcres: data.acres || null,
      primaryContact: data.primaryContact || null,
      primaryPhone: data.primaryPhone || null,
      commodities: savedCommodities,
      linkedProducerIds: savedLinkedIds,
      grainOnFarm: data.grainOnFarm,
      contacts: data.contacts,
      binSites: data.binSites
    };

    // The edit shows at once wherever the producer's details are read; the save's answer replaces it. A producer with
    // no saved details yet gets them here for the first time.
    const existingPd = this.producerProfiles.profileOf(data.customerId)
      ?? { id: 0, customerId: data.customerId, scoularId: customer.scoularId, customerName: customer.name, createdBy: '', createdAt: '' };
    this.producerProfiles.put({ ...existingPd, totalAcres: data.acres || undefined, primaryContact: data.primaryContact || undefined, primaryPhone: data.primaryPhone || undefined, commodities: savedCommodities ?? undefined, linkedProducerIds: savedLinkedIds ?? undefined, grainOnFarm: optimisticGrain, contacts: optimisticContacts, binSites: optimisticBinSites });

    // Linked-producer membership just changed — invalidate the BFS cache so the
    // next visit to the affected customers re-walks the graph. We don't know the
    // full transitive set without re-walking, so the safest cheap fix is to clear
    // everything; the cache will rebuild lazily as the user clicks through.
    this.linked.forgetWalks();

    this.apiService.saveProducerDetails(data.customerId, savePayload).subscribe({
      next: (pd) => {
        this.producerProfiles.put(pd);
        this.toastService.success('Producer updated successfully');
      },
      error: err => { if (!alreadyShown(err)) this.toastService.error('Failed to save producer details'); }
    });

    for (const linkedIdStr of data.removedIncomingIds) {
      // Look in BOTH the main customer roster and the cross-TU cache — linked customers
      // outside the currently-selected trade units live in the cross-TU cache and would
      // be silently skipped otherwise.
      const linkedCustomer = this.customers().find(c => c.scoularId === linkedIdStr)
        ?? this.linked.crossTradeUnitCustomers().find(c => c.scoularId === linkedIdStr);
      if (!linkedCustomer) continue;
      const currentSourceId = customer.scoularId || '';
      const linkedId = linkedCustomer.id;
      const existingPd = this.producerProfiles.profileOf(linkedId);
      const updatedLinkedIds = profileLinkedIds(existingPd).filter(id => id !== currentSourceId);
      this.apiService.saveProducerDetails(linkedId, {
        scoularId: linkedCustomer.scoularId || null,
        customerName: linkedCustomer.name,
        totalAcres: existingPd?.totalAcres ?? null,
        primaryContact: existingPd?.primaryContact ?? null,
      primaryPhone: existingPd?.primaryPhone ?? null,
        commodities: existingPd?.commodities ?? null,
        linkedProducerIds: updatedLinkedIds.length > 0 ? updatedLinkedIds.join(',') : null,
        // grainOnFarm intentionally omitted — this save isn't editing grain on farm, and the server
        // preserves the existing rows when it is absent (a cached copy could be older than a teammate's edit).
        // `contacts` intentionally omitted — the server preserves existing rows when absent.
      }).subscribe({
        // The linked groups read the links from ProducerProfiles, so the removed link is gone from them at once (no
        // stale A→C edge lingering after removal).
        next: (pd) => this.producerProfiles.put(pd),
        error: (err) => this.backgroundFailures.report('update the linked producer', err)
      });
    }

    if (data.primaryContact) {
      // Propagate the FULL primary contact row (name + phone + email) to ALL linked producers
      // that don't have one yet.
      const primaryRow = data.contacts.find(c => c.isPrimary)
        ?? { name: data.primaryContact, phone: data.primaryPhone || undefined, isPrimary: true };
      const allKnown = [...this.customers(), ...this.linked.crossTradeUnitCustomers()];
      for (const linkedIdStr of data.linkedProducerIds) {
        const linkedCustomer = allKnown.find(c => c.scoularId === linkedIdStr);
        if (linkedCustomer) {
          this._propagatePrimaryContact(linkedCustomer, primaryRow);
        } else {
          // Linked producer not loaded locally — fetch by sourceId then propagate
          this.customersApi.getCustomerBySourceId(linkedIdStr).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: (fetched) => {
              this.linked.put(fetched);
              this._propagatePrimaryContact(fetched, primaryRow);
            },
            error: (err) => this.backgroundFailures.report('load a linked producer', err)
          });
        }
      }
    }

    const index = customers.findIndex(c => c.id === updated.id);
    if (index >= 0) {
      const arr = [...customers];
      arr[index] = updated;
      this.customers.set(arr);
    } else {
      this.customers.set([...customers, updated]);
    }

    // Keep the cross-TU cache in sync too — a customer viewed across TU boundaries may
    // live there instead of the main roster, and would keep showing the pre-edit eSign.
    this.linked.refresh(updated);

    this.selectedCustomer.set(updated);
    this.customerStore.setCustomers(this.customers());
    this.appState.selectCustomer(updated);
    // The producer as they now are (an onboarding cleared the candidate flag, perhaps with a new id); the notes of a
    // newly linked producer show as the group grows.
    this.engagement.select(updated);

    // Fetch any newly linked producers that aren't loaded yet so the dropdown updates
    // immediately. Recursive BFS (transitive) so newly added edges extend the group.
    this._fetchMissingLinkedProducers(updated);
  }

  /**
   * Every producer transitively linked to `customer`, forward and reverse, among the trade units' customers and the
   * producers linked from outside them (LinkedProducersStore.groupOf). One not fetched yet is left out until its fetch
   * lands, which re-renders.
   */
  getLinkedGroup(customer: Customer): Customer[] {
    return this.linked.groupOf(customer);
  }

  handleSelectLinkedCustomer(customerId: number): void {
    if (customerId === this.selectedCustomer()?.id) return;
    // Cancel the previous selection's in-flight per-customer fetches, exactly as
    // handleSelectCustomer and _onTradeUnitsChanged do. Without this, clicking linked producer B
    // then C left B's fetches running; whichever resolved last won, so C's profile could get
    // overwritten with B's contracts/tickets/notes.
    this._cancelSelection$.next();
    // Reset navigation context — user is manually selecting a linked producer
    this.pendingContractId.set(null);
    this.pendingTab.set(null);
    this.pendingTicketCrop.set(null);
    // Cache the departing customer so getLinkedGroup can still find it for reverse-link
    // lookups after the new customer is selected (prevents the dropdown from disappearing).
    const departing = this.selectedCustomer();
    if (departing && !this.customers().some(c => c.id === departing.id)) this.linked.put(departing);
    const customer = this.customers().find(c => c.id === customerId);
    if (customer) {
      this.selectedCustomer.set(customer);
      this._fetchMissingLinkedProducers(customer);
      this.producerActivity.select(customer);
      this.production.select(customer, { plantingYear: this.pendingPlantingYear(), reread: true });
      this.engagement.select(customer);
    } else {
      // Linked customer is in a different trade unit — fetch them from the API
      this.customersApi.getCustomerById(customerId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (fetched) => {
          // Cache so getLinkedGroup can find them even though they're outside the TU filter
          this.linked.put(fetched);
          this.selectedCustomer.set(fetched);
          this._fetchMissingLinkedProducers(fetched);
          this.producerActivity.select(fetched);
          this.production.select(fetched, { plantingYear: this.pendingPlantingYear(), reread: true });
          this.engagement.select(fetched);
        },
        error: (err) => this.backgroundFailures.report('load the selected producer', err)
      });
    }
  }
}
