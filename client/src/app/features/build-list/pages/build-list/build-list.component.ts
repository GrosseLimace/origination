import { Component, ChangeDetectionStrategy, DestroyRef, inject, effect, untracked, signal, computed, viewChild, ElementRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { forkJoin, from, of, catchError, mergeMap, toArray, timeout, tap, Subject, takeUntil } from 'rxjs';
import { MsalService } from '@azure/msal-angular';
import { ApiService } from '@core/services/api.service';
import { AppStateService, BuildListState } from '@core/services/app-state.service';
import { DataPreloadService } from '@core/services/data-preload.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { UserRolesService } from '@core/services/user-roles.service';
import { NlqFilterService, NlqFilterContext } from '@core/services/nlq-filter.service';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain, DpContract, SavedList, TeamMember, ProducerDetails, RefinementFilters, QueryLibraryItem, GrainOnFarmItem, DashboardPlantingEstimate, Commodity } from '@models';
import { dpTotalBushels } from '@shared/utils/dp-aggregate';
import { commodityChipClass } from '@shared/utils/commodity-color';
import { plantingChips, plantingQueryScope, PlantingChip } from '@shared/utils/planting-chips';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, CardDescriptionComponent } from '@shared/components/card/card.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { BadgeComponent } from '@shared/components/badge/badge.component';
import { DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent } from '@shared/components/dialog/dialog.component';
import { InputComponent } from '@shared/components/input/input.component';
import { CustomerMapComponent } from '@features/customers/components/map/customer-map.component';
import { TradeUnitSelectorComponent } from '@shared/components/trade-unit-selector/trade-unit-selector.component';
import { HighlightPipe } from '@shared/pipes/highlight.pipe';
import { ClampOverflowDirective } from '@shared/directives/clamp-overflow.directive';
import { buildCropGroupLookup } from '@shared/utils/crop-group-match';
import { isGrainAndBinSitesCategory, binSiteGrainBreakdown, BinSiteGrainGroup, formatLastBid } from '@shared/utils/grain-on-farm';
import { binSiteNames, notesMentioningBinSites, splitByBinSiteNames, BIN_SITE_NAME_CLASS } from '@shared/utils/bin-site-mentions';
import { countActiveRefinements, hasAnyRefinement, hiddenRefineFilters } from '../../utils/refine-panel';
import { filterByRefinements, applyMemberOverrides, collapseLinkedComponents, RefinementFilterSources } from '../../utils/refinement-filters';
import { aggregateMatchingNotes, buildNoteFilterPredicate, indexMatchingNotesByCode, isNoteFilterActive, lastContactBadges, lastContactTimeByCustomer, MatchedNote, noteScope, NoteScope, parseNoteTime } from '../../utils/note-filters';
import { customerPacingDirection } from '../../utils/contract-pacing';
import { evaluatePlantingCoverage } from '../../utils/planting-coverage';
import {
  binSiteGrainHiddenLabel, binSiteGrainSummary, commodityCategoryByKey, contractsByCustomerCode, CropBushels, cropsByCustomer, dpBreakdown,
  formattedLocation, grainOnFarmBreakdown, groupByCustomerId, hasBinSiteGrain, initials, linkedProducerInfo, storageBreakdown, storageTotalBushels,
} from '../../utils/result-rows';
import {
  filterLibrary, groupLibrary, libraryCategories, libraryCategoryForQuery, matchedPatternLabels, searchSavedLists, searchTeamLists,
} from '../../utils/query-library';
import { detectFocusTab } from '../../utils/focus-tab';
import { buildSavedListPayload, SavedListPayload } from '../../utils/saved-list-payload';
import { binNoteContentAny, planBinSiteNoteChunks } from '../../utils/bin-site-notes';
import { scopeCommodities } from '@shared/utils/commodity-scope';
import { buildLinkedProducerComponents } from '@shared/utils/linked-producers';
import { filterSavedListsByTradeUnitOverlap } from '@shared/utils/saved-list-trade-units';
import { environment } from '@env/environment';

@Component({
  selector: 'app-build-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
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
    HighlightPipe,
    ClampOverflowDirective
  ],
  templateUrl: './build-list.component.html',
  styles: [`input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }`],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BuildListComponent {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);

  /** True when the trade-unit contract or ticket read FAILED, so an empty result set is an outage
   *  rather than a genuine answer. Every empty state on this screen has to check it: a CTRM timeout
   *  otherwise reads as "no producers found", which is indistinguishable from a real empty list. */
  readonly sourceLoadFailed = computed(() =>
    this.appState.contractsLoadFailed() || this.appState.ticketsLoadFailed());

  /** A read that timed out client-side rather than failing - the data is still coming. */
  readonly sourceLoadPending = this.appState.sourceLoadPending;
  private readonly dataPreloadService = inject(DataPreloadService);
  private readonly toastService = inject(ToastService);
  private readonly nlqFilterService = inject(NlqFilterService);
  private readonly msalService = inject(MsalService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly usageTracking = inject(UsageTrackingService);
  private readonly userRoles = inject(UserRolesService);

  /** Manager = holds the "Admin" app role (same gate as the Usage Dashboard). Drives the
   *  manager-only "Team Lists" library category. */
  readonly isManager = this.userRoles.isAdmin;

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
  // Mirrors _contractsReady/_dpReady for storage: false until a FRESH _loadFresh confirms
  // storedGrain. The recovery effect used to gate on storedGrain().length > 0, which meant a
  // trade unit with genuinely zero storage rows (or a swallowed storedgrain fetch failure)
  // could never satisfy the gate — a Storage prompt staged during load stayed on the spinner
  // forever. Loaded-flag, not length, so a real empty result still resolves.
  private _storageReady = signal(false);
  private _loadRequestId = 0;
  /** Fires at the start of every _loadFresh so the previous load's subscriptions (core forkJoin +
   *  background tickets) are dropped instead of lingering until they resolve. The requestId guard
   *  already discarded their results; this stops the component from waiting on them at all, which
   *  matters when the non-deferred selector fires one full reload per checkbox click. */
  private readonly _cancelLoad$ = new Subject<void>();
  /** Set when processQuery was called before core data was loaded (a prompt picked while a
   *  trade-unit reload is in flight). Holds the trade-unit override so the re-run is identical to
   *  the original call. Cleared by clearQuery, by a real processQuery run, and by the re-run. */
  private _parkedQuery: { override?: string[] } | null = null;
  private _queryGenId = 0;
  // Key of the server-narrowed note slice currently in this.notes() for DISPLAY (encodes the
  // query generation + scope, e.g. `${gen}:content:beans|corn`, `${gen}:w:3`, `${gen}:pinned`).
  // Scoped reads are LOCAL-only — they never warm appState.notes/notesLoaded (that cache means
  // "the full set"), so a partial slice can't leak to other consumers as if it were complete.
  private _loadedNoteScopeKey = signal<string>('');
  private _scopedNotesFetchInFlight = false;
  /** The refinements of a note-scope request that arrived while a different scoped fetch was in
   *  flight. Held rather than dropped so the in-flight handler can re-run it once it settles.
   *  Stores the criteria, not just a flag: the stranded request is usually the STAGED refine set,
   *  which is not appliedRefinements() yet — retrying with the default would fetch the wrong scope
   *  and leave the staged apply just as stuck. Last request wins. */
  private _supersededNoteScopeRequest: RefinementFilters | null = null;
  // Batched note-load bookkeeping ('batched' scope): customerIds whose note bodies have already
  // been fetched for DISPLAY, and an in-flight guard so batches serialize (each re-checks on
  // completion for producers that rendered while it was loading).
  private _batchedNoteCustomerIds = new Set<number>();
  private _batchNotesFetchInFlight = false;
  private _pendingIncludedIds: number[] = [];
  // True once the forkJoin (or cache restore) has populated all core data signals.
  // Guards processQuery() and example chips from running against partial/empty data.
  readonly coreDataLoaded = signal(false);
  // All trade units the user can access (union of all groups from the TradeUnitPreferences DB)
  private _allUserTradeUnits = signal<string[]>([]);

  // Re-trigger a staged query when needed data arrives from the background refresh.
  // When processQuery() detects missing data, it keeps isProcessing=true and returns.
  // This effect watches the data signals and re-triggers processQuery when they update.
  //
  // The guard also fires on waitingForTickets(): a ticket query whose _applyNlqFilter ran via
  // the background-refresh path (forkJoin success re-runs it while !isProcessing) parks on the
  // "Loading ticket data…" spinner with isProcessing already false. Gating only on isProcessing
  // left that spinner stuck once _ticketsReady flipped true — the user had to change TU and
  // reselect to recover. Including waitingForTickets() clears it as soon as tickets land.
  private _dataReadyEffect = effect(() => {
    this.notes();
    this.appState.notesLoaded();
    this._loadedNoteScopeKey();   // re-run when a scoped note slice lands
    this.storedGrain();
    this.dpContracts();
    this._dpReady();
    this._ticketsReady();
    this._contractsReady();
    // TRACKED, not just read inside untracked() below. The failure flags flip AFTER a query is already
    // staged - the user types a ticket prompt while the read is in flight, and it fails a moment later.
    // Nothing else this effect tracks changes on that path (the [] fallback never calls setTickets, so
    // _ticketsReady stays false), so without this dependency the effect never re-runs and the query hangs
    // on "Processing query..." exactly as it did before the guard was added.
    this.sourceLoadFailed();
    this.appState.sourceLoadPending();   // tracked for the same reason: it flips after a query is staged
    this._storageReady();
    if (this.queryText().trim() && (this.isProcessing() || this.waitingForTickets() || this.waitingForNotes() || this.waitingForDp()) && this.coreDataLoaded()) {
      untracked(() => {
        // A staged query waits for data to ARRIVE. If the read that would deliver it FAILED, waiting is
        // futile - the spinner would sit on "Processing query..." for the rest of the session, which is
        // worse than the empty list this whole effort set out to fix: at least an empty list ends.
        //
        // Found by the failure drill on 2026-08-27: with CTRM unreachable, the producer screen and the
        // dashboard both showed their error states correctly, but Build-a-List hung. The error banner
        // lives in the results branch, and a stalled query never reaches it.
        if (this.sourceLoadFailed() || this.appState.sourceLoadPending()) {
          this.waitingForTickets.set(false);
          this.waitingForNotes.set(false);
          this.waitingForDp.set(false);
          this.isProcessing.set(false);
          // Render whatever the query can answer from what did load; the banner explains the gap.
          this._applyNlqFilter();
          return;
        }

        // Re-check if the needed data is now available
        const q = this.queryText();
        const ticketsOk = !this.nlqFilterService.queryInvolvesTickets(q) || this._ticketsReady();
        const contractsOk = !this.nlqFilterService.queryInvolvesContracts(q) || this._contractsReady();
        const storageOk = !this.nlqFilterService.queryInvolvesStorage(q) || this._storageReady();
        // Loaded-flag, not length: a TU with genuinely zero DP rows must satisfy this or the
        // spinner never clears.
        const dpOk = !this.nlqFilterService.queryInvolvesDpContracts(q) || this._dpReady();
        // Gate on notesLoaded (not notes().length) so a trade unit with genuinely zero notes
        // doesn't hang the spinner forever. noteFilterActive() is true only when a prompt/refine
        // actually reads note content — non-note prompts never wait on notes.
        const notesOk = this._notesReadyForQuery();
        if (ticketsOk && contractsOk && storageOk && dpOk && notesOk) {
          this.waitingForTickets.set(false);
          this.waitingForNotes.set(false);
          this.waitingForDp.set(false);
          // Async coverage queries own isProcessing until their fetch resolves (see _applyNlqFilter).
          if (!this._applyNlqFilter()) this.isProcessing.set(false);
        }
      });
    }
  });

  // Commits a staged refine (_pendingApplyCriteria) once the dataset(s) it needs resolve.
  // Declared immediately after _dataReadyEffect: field-initializer effects run in declaration
  // order on their first scheduling, so this commit lands before the batched-clear effect
  // (further down, keyed on _displayedMembershipKey) can observe the new result membership —
  // without that ordering, that effect could wipe a note slice this one just fetched.
  // See _commitRefinements for why this is a SEPARATE effect from _dataReadyEffect rather than
  // a third writer of the waitingForTickets/waitingForNotes/waitingForDp flags.
  private _refineReadyEffect = effect(() => {
    const staged = this._pendingApplyCriteria();
    // Tracked reads — re-run whenever any of these resolve so a pending commit can proceed.
    this._loadedNoteScopeKey();
    this.appState.notesLoaded();
    this._ticketsReady();
    this._contractsReady();
    this._dpReady();
    this._storageReady();
    if (!staged) return;
    untracked(() => {
      if (this._pendingApplyGen !== this._queryGenId) {
        // A new prompt/clear started since this apply was staged — drop it rather than commit
        // criteria for a different query onto the current results.
        this._pendingApplyCriteria.set(null);
        return;
      }
      if (!this._criteriaReadiness(staged)) return; // still fetching — no writes at all
      this._pendingApplyCriteria.set(null);
      this.appliedRefinements.set(staged);
      this._syncNoteSliceToScope();
    });
  });

  // Pick up tickets that arrived via home's bulk fetch AFTER our own getTickets timed
  // out with []. Without this, a Build a List ticket query that ran during the empty
  // window would be stuck on "0 producers" even though the real tickets are now in
  // appState. If appState has more tickets than our local copy, hydrate and re-run
  // any already-completed ticket-dependent query so the result picks up the new data.
  private _appStateTicketsEffect = effect(() => {
    const appTickets = this.appState.tickets();
    const appTicketsTu = this.appState.ticketsTradeUnitKey();
    // Only adopt tickets that belong to the trade units we're currently showing. A length-only
    // comparison would hydrate from the PREVIOUS trade unit during a switch: our local set is
    // already cleared for the new TU while appState still holds the old, larger one (the two
    // clears are independent subscribers to selectedTradeUnits with no ordering guarantee). That
    // marked tickets ready and let a ticket query silently run against the wrong TU's deliveries.
    const currentTu = this.appState.selectedTradeUnits().join(',');
    if (appTicketsTu !== currentTu) return;
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
      } else {
        // No trade unit selected — return to the gated state (as on a fresh visit with no
        // selection) so the prompt library is disabled. Otherwise coreDataLoaded stays true from
        // the prior selection and a user could run a prompt with no trade unit scoped.
        // Drop any reload still in flight for the PREVIOUS selection too: left alone it would land
        // later, flip coreDataLoaded back on and fill customers() with the old trade unit's roster.
        this._cancelLoad$.next();
        this._loadRequestId++;
        this.loading.set(false);
        this.coreDataLoaded.set(false);
      }
    });
  });

  customers = signal<Customer[]>([]);
  contracts = signal<Contract[]>([]);
  tickets = signal<Ticket[]>([]);
  plantingIntentions = signal<PlantingIntention[]>([]);
  notes = signal<Note[]>([]);
  storedGrain = signal<StoredGrain[]>([]);
  dpContracts = signal<DpContract[]>([]);
  savedLists = signal<SavedList[]>([]);
  /** Saved lists belonging to other users in the selected trade unit(s) — manager-only. */
  teamSavedLists = signal<SavedList[]>([]);

  /** Reload team lists whenever the manager status resolves or the trade-unit selection changes.
   *  Scoped to the EXPLICITLY selected trade unit(s) — NOT effectiveTradeUnits(), which falls back
   *  to all of the manager's TUs and would surface teammates' lists from other groups/trade units.
   *  Non-managers, and an empty trade-unit selection (e.g. only a group is selected), see none. */
  private _teamListsEffect = effect(() => {
    const isMgr = this.isManager();
    const tus = this.appState.selectedTradeUnits();
    untracked(() => {
      if (!isMgr || tus.length === 0) {
        this.teamSavedLists.set([]);
        return;
      }
      this._refreshTeamLists(tus);
    });
  });

  /** Returns the effective trade units — explicit selection if any, otherwise all user-accessible TUs. */
  readonly effectiveTradeUnits = computed(() => {
    const explicit = this.appState.selectedTradeUnits();
    return explicit.length > 0 ? explicit : this._allUserTradeUnits();
  });


  readonly hasTradeUnits = computed(() => this.effectiveTradeUnits().length > 0);
  /** True only when the user has EXPLICITLY selected at least one trade unit (a group selection
   *  alone does not count). Drives team-list scoping/empty-state messaging. */
  readonly hasSelectedTradeUnit = computed(() => this.appState.selectedTradeUnits().length > 0);
  /** Comma-separated display names of the members the manager is currently building a list for. */
  readonly buildingForMembersLabel = computed(() => this.buildingForMembers().map(m => m.displayName).join(', '));
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

  /** True when the active query depends on tickets AND the last ticket fetch failed or timed
   *  out. Mirrors contractsUnavailableForQuery — shows a retry panel instead of a misleading
   *  "no producers found" for a ticket-aware prompt (e.g. "unapplied tickets"). */
  readonly ticketsUnavailableForQuery = computed(() =>
    this.ticketsLoadFailed() && this.nlqFilterService.queryInvolvesTickets(this.queryText()));

  /**
   * The other data a prompt can lean on whose last load FAILED, named for the panel that says so.
   * Each failed read resolves to an empty array, so without this a DP, planting or contact prompt
   * answers "no producers" (or, for "not contacted in N days", every producer) during an outage.
   * Contracts and tickets keep their own panels above, with Retry.
   */
  readonly unavailableDataForQuery = computed(() => {
    const q = this.queryText();
    const missing: string[] = [];
    if (this.appState.dpContractsLoadFailed() && this.nlqFilterService.queryInvolvesDpContracts(q)) missing.push('DP contracts');
    if (this.appState.plantingIntentionsLoadFailed() && this.nlqFilterService.queryInvolvesPlanting(q)) missing.push('planting intentions');
    if (this.nlqFilterService.queryInvolvesContact(q)) {
      if (this.appState.noteLastContactsLoadFailed()) missing.push('last-contacted dates');
      if (this.appState.myRemindersLoadFailed()) missing.push('follow-ups');
    }
    return missing;
  });

  /** The trade-unit producer read failed, so an empty trade unit is an outage, not an answer. */
  readonly customersLoadFailed = this.appState.customersLoadFailed;

  /** The saved-list read failed and nothing replaced it, so an empty library is not "none yet". */
  readonly savedListsLoadFailed = computed(() =>
    this.appState.savedListsLoadFailed() && this.savedLists().length === 0);

  /** The "Start with no producers" blank-start card — the deliberate opposite of "All
   *  producers". It always resolves to zero (see filterCustomers' early return), so the
   *  results area shows a friendly "build this list manually" prompt instead of the generic
   *  no-match banner. */
  readonly isBlankStartQuery = computed(() =>
    this.queryText().trim().toLowerCase() === 'start with no producers');

  /** Saved lists sharing at least one trade unit with the current selection (see
   *  saved-list-trade-units.ts). Trade units govern VISIBILITY only — opening a list runs its query
   *  against whatever is selected now (see loadSavedList), so the same list is reusable across
   *  trade units. */
  readonly visibleSavedLists = computed(() =>
    filterSavedListsByTradeUnitOverlap(this.savedLists(), this.appState.selectedTradeUnits()));

  readonly activeRefinementCount = computed(() => countActiveRefinements(this.appliedRefinements()));

  /** What the refinement filter (filterByRefinements) reads. Accessors, not values: it calls them
   *  inside displayedCustomers, so each signal is tracked only by the refinements that consult it. */
  private readonly _refineSources: RefinementFilterSources = {
    customers: () => this.customers(),
    notes: () => this.notes(),
    tickets: () => this.tickets(),
    plantingIntentions: () => this.plantingIntentions(),
    storedGrain: () => this.storedGrain(),
    dpContracts: () => this.dpContracts(),
    openContractsByCustomer: () => this._openContractsByCustomer(),
    cropGroupLookup: () => this._cropGroupLookup(),
    lastContactByCustomer: () => this.lastContactByCustomer(),
    linkedProducerComponents: () => this.linkedProducerComponents(),
    commodityConversions: () => this.appState.commodityConversions(),
    currentAccount: () => this.msalService.instance.getActiveAccount()
      ?? this.msalService.instance.getAllAccounts()[0],
    pacingDirection: (c: Customer) => this._getCustomerPacingDirection(c),
    isAppliedTicketsContext: () => this.isAppliedTicketsContext(),
    refineDimension: (r: RefinementFilters) => this.nlqFilterService.refineDimension(r, this.effectiveLibraryCategory()),
  };


  // Progressive rendering: paint the result list in batches so a huge match (e.g. "producers with
  // notes") renders ~instantly and scrolls smoothly, while ALL notes stay loaded in memory and
  // readable — each batch appears as the user scrolls to it (no new fetch). Reset to the first
  // batch whenever the result set changes (effect in the constructor).
  private static readonly _RENDER_BATCH = 40;
  /** Query-string budget for one bin-mention notes request (ids + site names, URL-encoded) — well
   *  under the 2,048 characters IIS allows by default. See _loadBinSiteNotes. */
  private static readonly BIN_NOTES_QUERY_BUDGET = 1500;
  readonly renderLimit = signal(BuildListComponent._RENDER_BATCH);
  /** The slice of displayedCustomers currently rendered to the DOM. */
  readonly renderedCustomers = computed(() => this.displayedCustomers().slice(0, this.renderLimit()));
  /** Order-insensitive signature of the displayed result MEMBERSHIP. The render-reset and batched-
   *  note-reset effects key off this rather than displayedCustomers() so that batched note appends —
   *  which only RE-SORT the list (by newest note) without changing who's in it — don't collapse the
   *  render window or wipe the notes we just loaded. Only a genuinely new/narrowed result set
   *  (new query, crop/state chip) changes the membership and triggers a reset. */
  private readonly _displayedMembershipKey = computed(() => {
    const ids = this.displayedCustomers().map(c => c.id);
    ids.sort((a, b) => a - b);
    return ids.join(',');
  });
  /** Bottom-of-list sentinel; when it scrolls into view we render the next batch. */
  private readonly _loadMoreSentinel = viewChild<ElementRef<HTMLElement>>('loadMoreSentinel');
  private _renderObserver?: IntersectionObserver;

  readonly displayedCustomers = computed(() => {
    let list = filterByRefinements(this.filteredCustomers(), this.appliedRefinements(), this._refineSources);
    // Apply manual member overrides: exclude removed, add included
    list = applyMemberOverrides(list, this.manuallyExcludedCustomerIds(), this.manuallyIncludedCustomers());

    // Collapse linked-customer groups (one row per linked-producer component) when the
    // linked-as-one-entity feature is active — see collapseLinkedComponents.
    if (this.linkedFeatureActive()) {
      list = collapseLinkedComponents(list, this.linkedProducerComponents());
    }

    // Order: when inline notes are showing (Notes / Contacts prompts), sort by the most
    // recent matching note across the producer's connected component — newest contact at
    // the top — so the merchandiser sees the freshest activity first. Alphabetical falls
    // through as the tiebreaker when timestamps match (or when both producers have no
    // notes, common for absence prompts like "never contacted"). For all other prompts,
    // sort alphabetically by name so finding a specific producer doesn't depend on data
    // recency.
    if (this.noteFilterActive()) {
      // Batched note prompts ("producers with notes", absence like "not contacted in 30 days")
      // load note BODIES progressively as the user scrolls — so a sort keyed on those bodies would
      // reshuffle rows as each batch arrives (jumpy, and it churns the render window). Instead sort
      // by the last-contact AGGREGATE, which is fully loaded up front: a stable key giving most
      // recently contacted first, with never-contacted producers sinking to the bottom.
      if (this._noteScope().mode === 'batched') {
        const timeByCustomer = this._lastContactTimeByCustomer();
        return [...list].sort((a, b) => {
          const dt = (timeByCustomer.get(b.id) ?? 0) - (timeByCustomer.get(a.id) ?? 0);
          if (dt !== 0) return dt;
          return (a.name || '').localeCompare(b.name || '');
        });
      }
      // Non-batched note prompts (content/author/pinned/window): the matching notes are all loaded
      // up front, so sort by the most recent matching note across the producer's linked component.
      const notesMap = this.matchingNotesByCustomer();
      const maxTimeFor = (customerId: number): number => {
        const notes = notesMap.get(customerId);
        if (!notes || notes.length === 0) return 0;
        let max = 0;
        for (const n of notes) {
          const t = parseNoteTime(n.createdAt);
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
    // Ranking prompts ("Top by grain on farm", "top 10 by contract value", …) come back from the
    // NLQ engine already sorted by the ranked metric — preserve that order instead of alphabetizing.
    if (this.nlqFilterService.isRankingQuery(this.queryText())) {
      return list;
    }
    // Grain on Farm & Bin Sites prompts (user 2026-10-09): producers with the most recent note naming one
    // of their bin sites first, then the most recent change to their bin sites or grain on farm, then
    // by name. The mention notes for the whole result are loaded up front (see _loadBinSiteNotes), so
    // this order doesn't shuffle as you scroll.
    if (this.showGrainOnFarmFilters()) {
      const notesByCustomer = this.binSiteNotesByCustomer();
      const lastMention = new Map<number, number>();
      for (const [id, found] of notesByCustomer) {
        let max = 0;
        for (const n of found.notes) max = Math.max(max, parseNoteTime(n.createdAt));
        lastMention.set(id, max);
      }
      const changed = (c: Customer) => (c.binSitesModifiedAt ? Date.parse(c.binSitesModifiedAt) || 0 : 0);
      return [...list].sort((a, b) =>
        (lastMention.get(b.id) ?? 0) - (lastMention.get(a.id) ?? 0)
        || changed(b) - changed(a)
        || (a.name || '').localeCompare(b.name || ''));
    }
    // Storage prompts: surface the producers with the most grain in storage first (sort by total
    // storage bushels desc), matching the inline per-commodity breakdown shown on each result.
    // Alphabetical name is the tiebreaker (e.g. producers with equal / zero storage).
    if (this.showStorageFilters()) {
      return [...list].sort((a, b) =>
        this.storageBu(b) - this.storageBu(a) || (a.name || '').localeCompare(b.name || ''));
    }
    // DP prompts: most bushels on DP first, matching the inline per-commodity chips.
    if (this.showDpFilters()) {
      return [...list].sort((a, b) =>
        this.dpBu(b) - this.dpBu(a) || (a.name || '').localeCompare(b.name || ''));
    }
    // Planting prompts: same idea, biggest acreage first — matching the per-crop acres chips.
    // Acres are computed once per producer up front rather than inside the comparator, which
    // would rebuild each producer's breakdown on every comparison.
    if (this.showPlantingFilters()) {
      const acres = new Map<number, number>(list.map(c => [c.id, this.plantingAcres(c)]));
      return [...list].sort((a, b) =>
        (acres.get(b.id) ?? 0) - (acres.get(a.id) ?? 0) || (a.name || '').localeCompare(b.name || ''));
    }
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  });

  /** Shared code/name → crop-group lookup, built once per commodities change. This is the SAME
   *  resolver _matchesCropFilter uses to MATCH chips — availableCrops() below must generate chips
   *  through this same resolver, or a chip could return zero producers for the very row that
   *  produced it (the round-trip invariant crop-group-match.ts documents). */
  private readonly _cropGroupLookup = computed(() => buildCropGroupLookup(this.appState.commodities()));

  /** Curated crop list from GET /api/commodities/planting — the catalog behind the Crops chips. */
  readonly plantingCommodities = signal<Commodity[]>([]);

  /**
   * The Crops refine chips: every commodity CODE (YC, HRWW, …) the selected trade units are set to
   * see, taken from the curated crop list and narrowed by scopeCommodities — the same catalog and
   * scoping the Planting Intentions and Bid Sheet crop pickers use.
   *
   * Codes, not categories (Corn, Wheat), because a category can't separate HRWW from SRWW. Chips
   * are offered for the whole scoped catalog, not just the codes present in the current results,
   * so the choices don't shift as the query changes — a chip that matches nobody is expected.
   *
   * Falls back to the codes actually present in the results when the curated list is unavailable,
   * so the filter degrades to something usable rather than disappearing.
   */
  readonly availableCrops = computed(() => {
    // Grain on Farm & Bin Sites prompts: the crops entered on the producers' grain-on-farm rows, not
    // the trade-unit catalog — the chip filters those rows (user 2026-10-09).
    if (this.showGrainOnFarmFilters()) return this._grainCropsInResults();
    const scoped = scopeCommodities(this.plantingCommodities(), {
      groupNames: this.appState.inScopeGroupNames(),
      tradeUnitCodes: this.appState.inScopeTradeUnitCodes(),
    });
    if (scoped.length > 0) {
      const codes = new Set<string>();
      for (const c of scoped) {
        const code = (c.code || '').trim();
        if (code) codes.add(code.toUpperCase());
      }
      return [...codes].sort();
    }
    return this._cropsPresentInResults();
  });

  /** Fallback chip source: the distinct commodity codes carried by the current results (plus the
   *  grain-on-farm and DP crops those rows hold, which needn't appear in customer.commodities). */
  private _cropsPresentInResults(): string[] {
    const codes = new Set<string>();
    const add = (raw: string | null | undefined) => {
      const trimmed = (raw || '').trim();
      if (trimmed) codes.add(trimmed.toUpperCase());
    };
    for (const c of this.filteredCustomers()) {
      for (const crop of (c.commodities ?? [])) add(crop);
    }
    if (this.showDpFilters()) {
      const dpByCustomer = this._dpByCustomerId();
      for (const c of this.filteredCustomers()) {
        for (const d of (dpByCustomer.get(c.id) ?? [])) add(d.crop);
      }
    }
    return [...codes].sort();
  }

  /** The distinct commodity codes on the current results' grain-on-farm rows (any row the user
   *  entered, with or without bushels on hand). */
  private _grainCropsInResults(): string[] {
    const codes = new Set<string>();
    for (const c of this.filteredCustomers()) {
      for (const g of (c.grainOnFarm ?? [])) {
        const code = (g.commodityCode || '').trim();
        if (code) codes.add(code.toUpperCase());
      }
    }
    return [...codes].sort();
  }

  readonly availableStates = computed(() => {
    const states = new Set<string>();
    for (const c of this.filteredCustomers()) {
      const s = c.extendedStateProvince || c.stateProvince;
      if (s) states.add(s);
    }
    // Previously hidden entirely for a single-state result set — that made the whole Location
    // section vanish, which read as "the state filter is missing" rather than "everyone's
    // already in the same state." Always show the chip(s) that exist.
    return [...states].sort();
  });

  /** Distinct Scoular delivery locations (elevatorCity, e.g. "Madrid, NE") across the current
   *  producers' tickets. Unlike crops, no group resolution needed — elevatorCity is already a
   *  clean display string resolved server-side from dbo.MbpLocationSynonym. Empty until the
   *  background ticket fetch (_loadFresh) resolves, same as crops/states populate lazily off
   *  whatever data has landed. */
  readonly availableDeliveryLocations = computed(() => {
    const scoularIds = new Set<string>();
    for (const c of this.filteredCustomers()) {
      if (c.scoularId) scoularIds.add(c.scoularId);
    }
    const locations = new Set<string>();
    for (const t of this.tickets()) {
      if (t.customerCode && scoularIds.has(t.customerCode) && t.elevatorCity) {
        locations.add(t.elevatorCity);
      }
    }
    return [...locations].sort();
  });

  queryText = signal('');
  filteredCustomers = signal<Customer[]>([]);
  showSaveDialog = signal(false);
  activeSavedList = signal<SavedList | null>(null);
  showDeleteDialog = signal(false);
  deleteListId = signal<number | null>(null);
  newListName = signal('');

  // ── Assign to team members (manager-only) ───────────────────────────────
  showAssignDialog = signal(false);
  showBuildForDialog = signal(false);
  /** When non-empty, the manager is building a list FOR these members (member-first flow). */
  buildingForMembers = signal<TeamMember[]>([]);
  assignListName = signal('');
  teamMembers = signal<TeamMember[]>([]);
  teamMembersLoading = signal(false);
  assignTargetIds = signal<Set<string>>(new Set());
  assigning = signal(false);
  /** The list payload (without targets) being assigned: the current built list or an existing one. */
  private _assignBase: SavedListPayload | null = null;
  isProcessing = signal(false);
  waitingForTickets = signal(false);
  /** True while a note-dependent query is parked waiting for the lazily-loaded full note set.
   *  Drives the "Loading note data…" spinner and suppresses the no-match banner so the query
   *  doesn't flash "no results" before the notes fetch lands (mirrors waitingForTickets). */
  waitingForNotes = signal(false);
  /** True while a DP-dependent query is parked waiting for the DP fetch. Drives the
   *  "Loading DP contract data…" spinner and suppresses the no-match banner, so a DP prompt doesn't
   *  read "no producers found" before the fetch lands (mirrors waitingForTickets / waitingForNotes). */
  waitingForDp = signal(false);
  /** Staged refinements waiting on a data fetch (applyFilters/a crop-or-state chip landed while a
   *  dataset the NEW criteria need — e.g. a crop chip that scopes to Storage, or a note refine
   *  needing a slice that hasn't been fetched — was unresolved). Deliberately SEPARATE from
   *  waitingForTickets/waitingForNotes/waitingForDp: those are read inside _dataReadyEffect's
   *  guard and written by _applyNlqFilter, and a third writer there would add an edge to the
   *  exact re-entrant cycle its comment warns about (re-asserting a wait flag on data EMPTINESS
   *  — rather than on fetch RESOLUTION — previously caused an infinite loop / hard freeze). This
   *  signal is written only by _commitRefinements (set) and _refineReadyEffect (clear to null),
   *  and _refineReadyEffect never touches waitingFor-flags or isProcessing, so it cannot join that cycle.
   *  Also, unlike those three, this one does NOT gate the results block in the template — the
   *  panel and the last good (data-backed) results stay mounted while it's true. */
  private _pendingApplyCriteria = signal<RefinementFilters | null>(null);
  /** Query generation the staged apply belongs to — a new prompt/clear bumps _queryGenId and
   *  clears _pendingApplyCriteria directly, so this is a belt-and-braces staleness guard, not
   *  the primary invalidation path. */
  private _pendingApplyGen = 0;
  /** True while a refine commit is waiting on a data fetch. Drives the Refine panel's inline
   *  spinner / disabled Apply / disabled Save — see _commitRefinements. */
  readonly refineDataPending = computed(() => this._pendingApplyCriteria() !== null);
  /** True once THIS page's local `dpContracts` signal has been hydrated for the current trade units.
   *  Deliberately separate from appState.dpContractsLoaded: the TU preload fills appState while this
   *  page's local copy is still empty, and the NLQ context reads the LOCAL copy — gating on the
   *  appState flag alone let a query run against an empty array and report "no producers found". */
  private _dpReady = signal(false);
  /** Guards the one-shot background DP fetch so overlapping queries don't each fire one. */
  private _dpFetchInFlight = false;
  /**
   * Keeps the local DP copy honest against the shared cache. Two cases this covers:
   *  - the TU preload lands AFTER this page hydrated, so the local copy is empty while appState
   *    has rows (adopt them);
   *  - the trade unit changed, so appState dropped its cache while this page still holds the old
   *    TU's rows (discard them, and stop reporting ready).
   * Without this the page can filter against stale or empty data and honestly report "no match".
   */
  private _dpCacheSyncEffect = effect(() => {
    const loaded = this.appState.dpContractsLoaded();
    const shared = this.appState.dpContracts();
    untracked(() => {
      if (!loaded) {
        if (this.dpContracts().length > 0) this.dpContracts.set([]);
        this._dpReady.set(false);
        return;
      }
      if (this.dpContracts() !== shared) this.dpContracts.set(shared);
      this._dpReady.set(true);
    });
  });
  /** Guards the one-shot background notes fetch so overlapping queries don't each fire one. */
  private _notesFetchInFlight = false;
  hasGenerated = signal(false);
  showMap = signal(false);
  loading = signal(false);
  loadingSavedLists = signal(false);
  detectedState = signal<string | null>(null);
  queryReturnedNoMatches = signal(false);
  /** True when a planting-coverage prompt ("under 50 percent contracted", "highest
   *  uncontracted bushels") came back empty/near-empty because none of the evaluated
   *  planting rows have a season yield target saved on the Planting Intentions dashboard —
   *  not because producers are genuinely well-contracted. Coverage can't be computed without
   *  a target (estimatedProduction needs acres × yield), so this distinguishes "the data
   *  isn't there yet" from a real zero-match, which otherwise looked identical.
   */
  coverageNeedsYieldTargets = signal(false);
  // True when the contracts fetch failed/timed out on the last load. Lets the results area
  // distinguish "couldn't load contract data" from a genuine zero-match — a contract-aware
  // query running against a silently-empty contracts array would otherwise read as "0 producers".
  // Both live on AppStateService rather than here: customer-list and the trade-unit preload hit the same
  // reads, and three private copies of these flags meant sourceLoadFailed missed most outages.
  readonly contractsLoadFailed = this.appState.contractsLoadFailed;
  readonly ticketsLoadFailed = this.appState.ticketsLoadFailed;
  showRefinePanel = signal(false);
  pendingRefinements = signal<RefinementFilters>({});
  appliedRefinements = signal<RefinementFilters>({});
  notContactedDaysInput = signal('');
  matchedPatterns = signal<string[]>([]);
  expandedNoteCount = signal<Map<number, number>>(new Map());
  readonly NOTE_PAGE_SIZE = 5;
  expandedLinkedCustomerIds = signal<Set<number>>(new Set());
  // Per-note "See more" state: ids of individual notes whose long body is expanded (clamped to a
  // few lines otherwise so one big note can't blow up a producer card).
  expandedNoteTextIds = signal<Set<number>>(new Set());
  // Note ids whose clamped body is ACTUALLY clipped (reported by ClampOverflowDirective) — drives
  // the "See more" toggle so it appears only for genuinely truncated notes, not by char-count guess.
  overflowingNoteIds = signal<Set<number>>(new Set());

  // ── Manage Members ──────────────────────────────────────────────────────
  showManageMembersPanel = signal(false);
  manuallyIncludedCustomers = signal<Customer[]>([]);
  manuallyExcludedCustomerIds = signal<Set<number>>(new Set());
  memberSearchTerm = signal('');
  memberSearchResults = signal<Customer[]>([]);
  memberSearchLoading = signal(false);
  private _memberSearchTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Cancels an in-flight member search when a newer keystroke supersedes it. */
  private readonly _cancelMemberSearch$ = new Subject<void>();

  readonly memberOverrideCount = computed(() =>
    this.manuallyIncludedCustomers().length + this.manuallyExcludedCustomerIds().size
  );

  /** Excluded customers as an array for template iteration. */
  readonly excludedCustomersList = computed(() => {
    const ids = [...this.manuallyExcludedCustomerIds()];
    const customerMap = new Map(this.customers().map(c => [c.id, c]));
    return ids.map(id => customerMap.get(id)).filter((c): c is Customer => !!c);
  });

  readonly matchedPatternLabels = computed(() => matchedPatternLabels(this.matchedPatterns()));

  // ── Pre-indexed computed signals for O(1) lookups ────────────────────────

  /** ALL contracts grouped by ctrmCustomerId — includes prior-year closed contracts for pacing. */
  private readonly _contractsByCustomer = computed(() => contractsByCustomerCode(this.contracts()));

  /** Open contracts only — used by refinement filters (no active, unconfirmed, overdue bu, etc.). */
  private readonly _openContractsByCustomer = computed(() => contractsByCustomerCode(this.contracts(), true));

  /** Raw latest-contact time (ms since epoch) per customerId, from the lightweight last-contact
   *  AGGREGATE (always loaded on TU change — not the full note set) with the linked-producer
   *  connected-component rollup applied. Because the aggregate is present up front, this is a
   *  STABLE sort key that doesn't shift as note bodies stream in for batched prompts. Absent from
   *  the map = the producer and its entire linked chain have never been contacted. */
  private readonly _lastContactTimeByCustomer = computed(() =>
    lastContactTimeByCustomer(this.appState.noteLastContacts(), this.linkedProducerComponents(), this.customers()));

  /** Most recent note per customer — pre-indexed for O(1) template lookup. Derived from the
   *  aggregate-backed {@link _lastContactTimeByCustomer} (with linked rollup), so the badge agrees
   *  with the sort order and the inline note panel. */
  readonly lastContactByCustomer = computed(() => lastContactBadges(this._lastContactTimeByCustomer()));

  // ── Note filters: derive whether a note-focused query/filter is active and surface the matching notes per customer for inline display in the result list. ───────────────

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
  readonly noteFilterActive = computed(() => isNoteFilterActive(this.appliedRefinements(), this.queryText()));

  /** Predicate that matches a note against whichever note criteria are active. */
  readonly noteFilterPredicate = computed<(n: Note) => boolean>(() =>
    buildNoteFilterPredicate(this.appliedRefinements(), this.queryText(), {
      // Author candidates for "by me" / "by someone else" filters. Same matcher the
      // service uses so saved-list "I contacted" filters work even when notes' CreatedBy
      // arrives as the raw UPN (e.g. "CEgr@scoular.com") instead of a display name.
      authorCandidates: () => this._authorCandidates(),
      matchesAuthor: (createdBy, candidates) => this.nlqFilterService.matchesAuthor(createdBy, candidates),
    }));

  /** The signed-in user's author candidates (MSAL display name + UPN), as the NLQ matcher builds them. */
  private _authorCandidates(): string[] {
    const account = this.msalService.instance.getActiveAccount() ?? this.msalService.instance.getAllAccounts()[0];
    return this.nlqFilterService.buildAuthorCandidates(null, account?.name ?? '', account?.username ?? '');
  }

  /** Notes matching the active note filter, indexed by source customerCode.
   *  Each note is tagged with `viaName = "{Name} ({Code})"` of the customer it was
   *  placed on — applied uniformly to every note so the origin is always visible. */
  private readonly _matchedNotesByCode = computed(() => {
    if (!this.noteFilterActive()) return new Map<string, MatchedNote[]>();
    return indexMatchingNotesByCode(this.noteFilterPredicate(), this.customers(), this.notes());
  });

  /** Per-customer aggregated matching notes (own + linked + incoming), pinned-first then newest-first.
   *  Every note is tagged with viaName so its origin is always identifiable. */
  readonly matchingNotesByCustomer = computed(() => {
    if (!this.noteFilterActive()) return new Map<number, MatchedNote[]>();
    const matchesByCode = this._matchedNotesByCode();
    if (matchesByCode.size === 0) return new Map<number, MatchedNote[]>();
    return aggregateMatchingNotes(matchesByCode, this.customers(), this.linkedProducerComponents());
  });

  /** Matching notes for one customer — own notes only (not aggregated). Used in the linked-producer expand panel. */
  getOwnMatchingNotes(customer: Customer): Array<Note & { viaName: string }> {
    return customer.scoularId ? (this._matchedNotesByCode().get(customer.scoularId) ?? []) : [];
  }

  /** Linked producers per customer for the inline linked panel (see linkedProducerInfo in utils).
   *  Returns an empty map unless the linked-as-one-entity feature is active (notes prompts or
   *  the "Producers with linked records" prompt) — for other queries each producer is its own row. */
  readonly linkedProducerInfoByCustomer = computed(() => {
    if (!this.linkedFeatureActive()) return new Map<number, { count: number; producers: Customer[] }>();
    return linkedProducerInfo(this.customers(), this.manuallyExcludedCustomerIds(), this.linkedProducerComponents());
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
  readonly cropsByCustomer = computed(() => cropsByCustomer(
    this._contractsByCustomer(), this.plantingIntentions(), this.tickets(), this.storedGrain(), this.customers()));

  // ── Query Library ──────────────────────────────────────────────────────
  queryLibrary = signal<QueryLibraryItem[]>([]);
  queryLibraryLoaded = signal(false);
  librarySearchText = signal('');
  /** A Help panel example query waiting for the library to load. See the constructor. */
  private readonly _pendingExample = signal<string | null>(null);
  selectedCategory = signal<string | null>(null);
  selectedLibraryQuery = signal<QueryLibraryItem | null>(null);
  private _searchLogTimeout: ReturnType<typeof setTimeout> | null = null;

  showRequestForm = signal(false);
  requestQueryText = signal('');

  /** Prompt cards for the selected category and search text. Cards tagged "reminders" are hidden while
   *  the reminders feature is off — see filterLibrary. */
  readonly filteredLibrary = computed(() =>
    filterLibrary(this.queryLibrary(), this.librarySearchText().toLowerCase().trim(), this.selectedCategory(), environment.remindersEnabled));

  readonly libraryCategories = computed(() => libraryCategories(this.queryLibrary(), this.isManager()));

  /** Team lists shown in the library — manager-only, scoped to the current TU (overlap match done
   *  server-side), and matched against the library search text. Hidden when a non-'Team Lists'
   *  category is selected. */
  readonly libraryTeamLists = computed(() => {
    if (!this.isManager()) return [];
    const cat = this.selectedCategory();
    if (cat && cat !== 'Team Lists') return [];
    const search = this.librarySearchText().toLowerCase().trim();
    return searchTeamLists(this.teamSavedLists(), search);
  });

  /** Saved lists shown in the library — user-owned (API filters by createdBy already), overlap-
   *  scoped to the selected trade units (via visibleSavedLists), and matched against the library
   *  search text. Hidden when a non-'Saved Lists' category is selected. */
  readonly librarySavedLists = computed(() => {
    const cat = this.selectedCategory();
    if (cat && cat !== 'Saved Lists') return [];
    const search = this.librarySearchText().toLowerCase().trim();
    return searchSavedLists(this.visibleSavedLists(), search);
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
    return libraryCategoryForQuery(this.queryLibrary(), active.query);
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
  readonly hiddenFilters = computed<Set<string>>(() =>
    hiddenRefineFilters((this.selectedLibraryQuery()?.queryText || this.activeSavedList()?.query || '').toLowerCase()));

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
  readonly showDpFilters = computed(() => !this.isResolvingSavedListCategory() && this.effectiveLibraryCategory() === 'DP Contracts');
  readonly showPlantingFilters = computed(() => !this.isResolvingSavedListCategory() && this.effectiveLibraryCategory() === 'Planting');
  /** The "Grain on Farm & Bin Sites" prompts (or a saved list from the pre-rename "Grain on Farm"):
   *  grain filters plus has/no bin sites in one panel, and crop + bushel chips on each result. */
  readonly showGrainOnFarmFilters = computed(() => !this.isResolvingSavedListCategory() && isGrainAndBinSitesCategory(this.effectiveLibraryCategory()));

  // ── Notes that mention a bin site (Grain on Farm & Bin Sites prompts, user 2026-10-09) ────────
  // Notes are added as usual; on these prompts a result row's middle column shows the producer's
  // notes that name one of their saved bin sites — the same column and note stack note prompts use.
  // Loaded by its own small batch loader (not the note-prompt machinery): as rows render, one fetch
  // per batch for those producers' notes containing any of their site names (a server superset the
  // client re-matches exactly).

  /** A bin-mention note's text split into runs, the site names marked (shown in blue). */
  binSiteRuns(text: string, siteNames: readonly string[]) { return splitByBinSiteNames(text ?? '', siteNames); }
  readonly binSiteNameClass = BIN_SITE_NAME_CLASS;

  /** Bin-site mention notes are on screen: these prompts, unless a notes filter owns the middle column. */
  readonly binNotesActive = computed(() => this.showGrainOnFarmFilters() && !this.noteFilterActive());

  /** Notes fetched for bin-site mentions (accumulated across render batches). */
  private readonly _binNotes = signal<Note[]>([]);
  /** "customerId:site names" already fetched — a renamed site changes the key, so it refetches. */
  private readonly _binNoteFetchedKeys = new Set<string>();
  private _binNotesFetchInFlight = false;

  /** Per producer: the notes naming one of their bin sites, pinned first then newest, and which sites. */
  readonly binSiteNotesByCustomer = computed(() => {
    const map = new Map<number, { notes: Note[]; sites: string[] }>();
    if (!this.binNotesActive()) return map;
    const byCustomer = new Map<number, Note[]>();
    for (const n of this._binNotes()) {
      const arr = byCustomer.get(n.customerId);
      if (arr) arr.push(n); else byCustomer.set(n.customerId, [n]);
    }
    for (const c of this.customers()) {
      const notes = byCustomer.get(c.id);
      if (!notes) continue;
      const found = notesMentioningBinSites(notes, binSiteNames(c.binSites));
      if (found) map.set(c.id, found);
    }
    return map;
  });

  /**
   * Fetches the bin-mention notes for EVERY producer in the result that has named bin sites (not just
   * the rendered rows) — the result is ordered by the latest such note, so it needs them all up front.
   * The ids and site names travel in the query string, and many sites could pass the 2,048-character
   * limit IIS applies by default (a rejected request would read as "no notes"), so the work is split
   * into requests under BIN_NOTES_QUERY_BUDGET, sent together; the rows re-order once when they land.
   * A single producer whose names alone pass the budget is fetched by id only (the client still matches).
   */
  private _loadBinSiteNotes(): void {
    if (!this.binNotesActive() || this._binNotesFetchInFlight) return;
    const chunks = planBinSiteNoteChunks(this.filteredCustomers(), this._binNoteFetchedKeys, BuildListComponent.BIN_NOTES_QUERY_BUDGET);
    if (chunks.length === 0) return;

    this._binNotesFetchInFlight = true;
    const requests = chunks.map(ch => this.apiService.getNotes(undefined, {
      customerIds: ch.ids,
      contentAny: binNoteContentAny(ch, BuildListComponent.BIN_NOTES_QUERY_BUDGET),
    }).pipe(catchError(() => of([] as Note[]))));
    // At most four requests in flight at once; order doesn't matter (results are flattened and deduped).
    from(requests).pipe(mergeMap(r => r, 4), toArray(), takeUntilDestroyed(this.destroyRef)).subscribe(results => {
      this._binNotesFetchInFlight = false;
      // Also on a failed piece: don't retry-loop it; the rows just show no mention notes.
      chunks.forEach(ch => ch.keys.forEach(k => this._binNoteFetchedKeys.add(k)));
      const seen = new Set(this._binNotes().map(n => n.id));
      const fresh: Note[] = [];
      for (const n of results.flat()) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        fresh.push(n);
      }
      if (fresh.length) this._binNotes.set([...this._binNotes(), ...fresh]);
      this._loadBinSiteNotes(); // anything that changed while these were in flight
    });
  }

  /** Load bin-mention notes whenever the result (or the prompt) changes. */
  private readonly _binNotesLoader = effect(() => {
    this.binNotesActive();
    this.filteredCustomers();
    untracked(() => this._loadBinSiteNotes());
  });
  readonly showGeneralFilters = computed(() => {
    if (this.isResolvingSavedListCategory()) return false;
    const cat = this.effectiveLibraryCategory();
    // 'Producers' cards (e.g. "All Producers") have no dimension of their own — the General
    // panel's producer-level fields (acres, contact info, eSign, linked producers) are exactly
    // the "common refine filters" a blank-start card needs, alongside the always-unconditional
    // Crops/Location/Delivery Location chips.
    return !cat || cat === 'General' || cat === 'Producers';
  });

  readonly groupedLibrary = computed(() => groupLibrary(this.filteredLibrary()));


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
          this.appState.setSavedListsLoadFailed(false);
          this.loadingSavedLists.set(false);
        },
        // The library panel says "Couldn't load your saved lists" from this, not "No saved lists yet".
        error: () => { this.appState.setSavedListsLoadFailed(true); this.loadingSavedLists.set(false); }
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
          this.appState.setQueryLibrary(items);
          this.queryLibraryLoaded.set(true);
        },
        error: () => { this.queryLibraryLoaded.set(true); this.toastService.error('Failed to load query library'); }
      });
    }

    // The Help panel's "Try an example" opens this page as /build-list?query=<Query Library name> —
    // including when the user is already on it, where the router reuses this component, so the param
    // is watched rather than read once. Once the library has loaded, run that query exactly as if its
    // card had been clicked; if no entry has that name (it was renamed), pre-fill the library search
    // with it instead. The param is then dropped so a reload or Back doesn't re-run it.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const name = params.get('query');
      if (name) this._pendingExample.set(name);
    });
    effect(() => {
      const name = this._pendingExample();
      if (!name || !this.queryLibraryLoaded()) return;
      untracked(() => {
        this._pendingExample.set(null);
        const item = this.queryLibrary().find(q => q.name.trim().toLowerCase() === name.trim().toLowerCase());
        if (item && !this.appState.allProducersMode()) this.selectLibraryQuery(item);
        else this.librarySearchText.set(name);
        void this.router.navigate([], { relativeTo: this.route, queryParams: { query: null }, queryParamsHandling: 'merge', replaceUrl: true });
      });
    });

    // Curated crop list — the source for the Crops refine chips. Scoped to the selected trade
    // units in availableCrops(); failure just leaves the chips falling back to the codes present
    // in the current results.
    this.apiService.getPlantingCommodities().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (commodities) => this.plantingCommodities.set(commodities ?? []),
      error: () => this.plantingCommodities.set([])
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

    // Collapse all expanded note rows whenever the filter inputs change. The
    // matching-note set has changed, so previously expanded customers may not
    // even be in the list anymore.
    effect(() => {
      this.appliedRefinements();
      this.queryText();
      untracked(() => {
        this.expandedNoteCount.set(new Map());
        this.expandedNoteTextIds.set(new Set());
        this.overflowingNoteIds.set(new Set());
      });
    });

    // Progressive rendering — reset to the first batch whenever the result MEMBERSHIP changes so a
    // new/narrowed result set starts small (and fast) rather than inheriting a large prior render
    // window. Keyed on membership (not displayedCustomers) so batched note appends, which only
    // re-sort the same producers, don't collapse the window. For a 'batched' note prompt a changed
    // membership also means the accumulated per-batch notes no longer describe the list — clear
    // them so the batch effect refetches from scratch.
    effect(() => {
      this._displayedMembershipKey();
      untracked(() => {
        this.renderLimit.set(BuildListComponent._RENDER_BATCH);
        if (this._noteScope().mode === 'batched') {
          this._batchedNoteCustomerIds.clear();
          if (this.notes().length) this.notes.set([]);
        }
      });
    });

    // 'batched' note prompts: as the render window grows (new query or scroll), fetch note bodies
    // for the just-rendered producers by customerId and accumulate them for display — the huge
    // "everyone with notes" set never blocks first paint.
    effect(() => {
      this.renderedCustomers();
      untracked(() => this._loadNotesForRenderedBatch());
    });

    // Observe the bottom sentinel; when it scrolls near the viewport, render the next batch.
    // rootMargin pre-loads slightly ahead so scrolling feels seamless. Re-wires whenever the
    // sentinel appears/disappears (it's only present while more rows remain to render).
    effect(() => {
      const el = this._loadMoreSentinel()?.nativeElement;
      this._renderObserver?.disconnect();
      if (!el) return;
      this._renderObserver = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) {
          this.renderLimit.update(n => n + BuildListComponent._RENDER_BATCH);
        }
      }, { rootMargin: '600px' });
      this._renderObserver.observe(el);
    });
    this.destroyRef.onDestroy(() => this._renderObserver?.disconnect());

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
          manuallyIncludedCustomerIds: this._allIncludedCustomerIds(),
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
      this.dpContracts.set(this.appState.dpContracts());
      // Only "ready" if the shared cache was actually populated by a completed fetch — otherwise a
      // DP query must still wait (and show its spinner) rather than filter on an empty array.
      this._dpReady.set(this.appState.dpContractsLoaded());
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

    // Interrupted-query recovery: if the user navigated away WHILE a query was still running, its
    // in-flight fetch was cancelled (takeUntilDestroyed) and state was saved with hasGenerated=false
    // and no results. Restoring that would leave the query text in the box with no results and no
    // spinner. Re-run it here so returning to the page transparently completes the query.
    // (A query that finished — hasGenerated=true — restored its results above and is NOT re-run,
    // so a legitimate zero-match result is preserved.)
    if (this.queryText().trim() && !this.hasGenerated() && !this.isProcessing()) {
      this.processQuery();
    }
  }

  /** Fetches all data fresh from the API for the current trade units.
   *  @param clearSignals If true, clears data signals immediately (TU change). If false, keeps them for display (background refresh). */
  private _loadFresh(clearSignals = false): void {
    this._cancelLoad$.next();
    const requestId = ++this._loadRequestId;
    this._ticketsReady.set(false);
    // Fresh contracts not yet confirmed — contract-aware queries will wait on this until the
    // forkJoin below resolves (covers the cache-restore background-refresh window).
    this._contractsReady.set(false);
    this._storageReady.set(false);
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

    // Fetch core data (everything except tickets and notes — tickets are slow and load in
    // background; the full note set is lazily fetched by _fetchAndFilter the first time a
    // query runs while it's missing, so page load never waits on the note download)
    forkJoin({
      customers: this.apiService.getCustomers(tuParam).pipe(
        tap(() => this.appState.setCustomersLoadFailed(false)),
        catchError(() => { this.appState.setCustomersLoadFailed(true); return of([] as Customer[]); })),
      contracts: this.apiService.getContracts(tuParam).pipe(
        tap(() => this.appState.setContractsLoadFailed(false)),
        catchError(() => { this.appState.setContractsLoadFailed(true); return of([] as Contract[]); })),
      plantingIntentions: this.apiService.getPlantingIntentions(tuParam).pipe(
        tap(() => this.appState.setPlantingIntentionsLoadFailed(false)),
        catchError(() => { this.appState.setPlantingIntentionsLoadFailed(true); return of([] as PlantingIntention[]); })),
      storedGrain: this.apiService.getStoredGrain(tuParam).pipe(catchError(() => of([] as StoredGrain[]))),
      savedLists: this.apiService.getSavedLists().pipe(
        tap(() => this.appState.setSavedListsLoadFailed(false)),
        catchError(() => { this.appState.setSavedListsLoadFailed(true); return of([] as SavedList[]); })),
      producerDetails: this.apiService.getAllProducerDetails().pipe(catchError(() => of([] as ProducerDetails[])))
    }).pipe(takeUntil(this._cancelLoad$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        // Ignore stale response from a previous TU's load
        if (requestId !== this._loadRequestId) return;

        this.customers.set(data.customers);
        this.contracts.set(data.contracts);
        this.plantingIntentions.set(data.plantingIntentions);
        // Seed notes from the shared lazy cache when another consumer already loaded it
        // (home saved-list enrichment, customer-list NLQ). Otherwise leave local notes
        // as-is; _fetchAndFilter tops them up when a query actually needs them.
        if (this.appState.notesLoaded()) this.notes.set(this.appState.notes());
        this.storedGrain.set(data.storedGrain);
        this.savedLists.set(data.savedLists);
        // Merge producer details into customer objects, then write to appState
        if (data.producerDetails.length > 0) this.appState.setProducerDetails(data.producerDetails);
        this._mergeProducerDetails(data.producerDetails);
        // Write to appState so other pages and restore path can use it
        this.appState.setCustomers(this.customers());
        this.appState.setContracts(data.contracts);
        this.appState.setPlantingIntentions(data.plantingIntentions);
        this.appState.setStoredGrain(data.storedGrain);
        this.appState.setSavedLists(data.savedLists);

        this.loading.set(false);
        this.coreDataLoaded.set(true);
        // Fresh contracts are now in hand (real data, or [] with contractsLoadFailed set on a
        // failed inner fetch) — release any contract-aware query staged in processQuery.
        this._contractsReady.set(true);
        this._storageReady.set(true);

        // Re-run active query with fresh data — cached data may have been stale/incomplete
        // (e.g., notes hadn't finished loading on home page before user navigated here).
        // The _dataReadyEffect handles the case where isProcessing is true (query staged
        // before data loaded). This handles the case where a query already ran against
        // stale cache and needs to silently refresh with the now-complete data.
        if (this.queryText().trim() && this.hasGenerated() && !this.isProcessing()) {
          this._applyNlqFilter();
        } else if (this._parkedQuery) {
          // A prompt picked DURING this reload was parked by processQuery's coreDataLoaded guard
          // (the library stays clickable while a trade-unit change reloads). Re-enter processQuery
          // instead of leaving it to _dataReadyEffect: that effect only WAITS for data, it never
          // starts the lazy note/DP fetches, so a note or DP prompt would spin forever.
          // Keyed on the explicit parked marker, NOT on isProcessing && !hasGenerated: a saved list
          // clicked during the cache-path background refresh is ALSO in that state while its own
          // _fetchAndFilter is in flight, and re-entering would bump _queryGenId and discard that
          // fetch - the list rendered without its hand-added members.
          this._runParkedQuery();
        }
      },
      error: () => {
        if (requestId !== this._loadRequestId) return;
        this.loading.set(false);
        this.coreDataLoaded.set(true); // Mark loaded even on error so UI isn't stuck
        this._contractsReady.set(true); // Don't strand contract-queries waiting forever on error
        this._storageReady.set(true); // Same — don't strand storage-queries waiting forever on error
        this.toastService.error('Failed to load data');
        // Same re-entry as the success path: a prompt parked during this reload must not sit on
        // "Processing query..." for a note/DP fetch that nothing started.
        if (this._parkedQuery) this._runParkedQuery();
      }
    });

    // Tickets load in background — processQuery waits for them only if the query needs tickets.
    // The client timeout (310s) is set ABOVE the server's documented 300s command-timeout
    // ceiling for this exact query (see TicketRepository.cs) — a shorter client timeout was
    // aborting the request before the server could genuinely answer, so a slow-but-successful
    // ODS scan looked identical to "no tickets" and every ticket prompt silently came back
    // empty. On a genuine timeout/HTTP error we now mark ticketsLoadFailed so the results area
    // can show a retry panel instead of a misleading "no producers found" (mirrors contracts).
    let ticketFetchFailed = false;
    this.apiService.getTickets(tuParam).pipe(
      timeout(310000),
      tap(() => {
        this.appState.setTicketsLoadFailed(false);
        this.appState.setSourceLoadPending(false);
      }),
      // A TIMEOUT is not a failure. Whichever source answers, it keeps working and caches the result, so
      // a retry shortly after succeeds - which makes "could not be loaded" a false statement. Only a real
      // error arms the failed flag; a timeout says "still loading". The 310s bound above earns its keep on
      // the CTRM path too: a cold trade-unit walk has been measured at up to 211s.
      catchError((err) => {
        if (err?.name === 'TimeoutError') this.appState.setSourceLoadPending(true);
        else ticketFetchFailed = true;
        return of([] as Ticket[]);
      }),
      takeUntil(this._cancelLoad$),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(tickets => {
      if (requestId !== this._loadRequestId) return;
      if (tickets.length > 0) {
        this.tickets.set(tickets);
        this.appState.setTickets(tickets);
      } else if (this.appState.tickets().length > 0) {
        // Timeout fired locally but the TU-wide cache already has data (e.g. another lazy
        // consumer populated it). Hydrate local from appState so the build-list filter sees
        // the real tickets instead of [].
        this.tickets.set(this.appState.tickets());
      }
      // Only flag a failure when nothing usable came back at all — the appState fallback
      // above means the data genuinely arrived (via another consumer), so that's a success.
      this.appState.setTicketsLoadFailed(ticketFetchFailed && this.tickets().length === 0);
      this._ticketsReady.set(true);
    });
  }

  /** Merge ProducerDetails into customer objects (commodities, acres, bin sites, etc.). */
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
          binSitesModifiedAt: pd.binSitesModifiedAt ?? customer.binSitesModifiedAt,
          primaryContact: pd.primaryContact ?? customer.primaryContact,
          primaryPhone: pd.primaryPhone ?? customer.primaryPhone,
          // User-entered contact rows exist only on producer details (the customer record never
          // carries them), and the has-email / has-phone refinements read them. Same rule as the
          // shared applyProducerDetails.
          contacts: pd.contacts ?? customer.contacts,
          commodities: pd.commodities ? pd.commodities.split(',').map(c => c.trim()) : customer.commodities,
          // Per-commodity grain-on-farm (bushels on hand + $/bu target) — carried onto the customer
          // so the NLQ engine can filter "grain on farm" / "target" prompts client-side.
          grainOnFarm: pd.grainOnFarm ?? customer.grainOnFarm,
          // Bin sites (lat/long) — carried over so "producers with bin sites" filters client-side.
          binSites: pd.binSites ?? customer.binSites,
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

  /** Re-runs the processQuery call that was parked behind the coreDataLoaded guard. */
  private _runParkedQuery(): void {
    const parked = this._parkedQuery;
    this._parkedQuery = null;
    if (parked && this.queryText().trim()) this.processQuery(parked.override);
  }

  clearQuery(): void {
    this._queryGenId++;
    this._parkedQuery = null;
    this.isProcessing.set(false);
    this.waitingForTickets.set(false);
    // Must be cleared here too: the recovery effect only clears it while a query is active, so a
    // note prompt abandoned mid-fetch would leave "Loading note data…" spinning under the library.
    this.waitingForNotes.set(false);
    this.waitingForDp.set(false);
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
    this._pendingIncludedIds = [];
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
    this.waitingForNotes.set(false);
    this.waitingForDp.set(false);
    this.queryReturnedNoMatches.set(false);
    this.showRefinePanel.set(false);
    this.pendingRefinements.set({});
    this.appliedRefinements.set({});
    this.notContactedDaysInput.set('');
    this.showManageMembersPanel.set(false);
    this.manuallyIncludedCustomers.set([]);
    this._pendingIncludedIds = [];
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

  /** Retry after a ticket-fetch failure/timeout surfaced the "couldn't load ticket data"
   *  panel. Same recovery path as retryContractLoad — a single fresh load refreshes every
   *  dataset, tickets included. */
  retryTicketLoad(): void {
    this.isProcessing.set(true);
    this._loadFresh(true);
  }

  processQuery(overrideTradeUnits?: string[]): void {
    if (!this.queryText().trim()) return;
    // Don't run if core data hasn't loaded yet — set isProcessing so the _dataReadyEffect
    // auto-triggers this query when coreDataLoaded becomes true.
    if (!this.coreDataLoaded()) {
      this.isProcessing.set(true);
      this._parkedQuery = { override: overrideTradeUnits };
      return;
    }
    this._parkedQuery = null;

    const queryGen = ++this._queryGenId;
    this.isProcessing.set(true);
    this.waitingForTickets.set(false); // Reset — will be set to true below only if this query needs tickets
    this.waitingForNotes.set(false);   // Reset — will be set to true below only if this query needs notes
    this.waitingForDp.set(false);      // Reset — will be set to true below only if this query needs DP

    // Saved lists always re-fetch to ensure fresh data (_fetchAndFilter loads notes itself).
    if (overrideTradeUnits && overrideTradeUnits.length > 0) {
      this._fetchAndFilter(overrideTradeUnits);
      return;
    }

    // Notes are lazily loaded now (page load no longer downloads them). Kick off the one-shot
    // fetch up front (idempotent) so it's in flight regardless of which wait below returns
    // first — otherwise a note query that also waits on tickets would never trigger the fetch.
    const needsNotes = this.noteFilterActive();
    if (needsNotes) this._ensureNotesForQuery();

    // If query needs tickets and they haven't loaded yet, wait for them specifically.
    // Tickets are the only data loaded outside the main forkJoin (background subscription),
    // so they're the only ones that might genuinely not be available yet.
    const needsTickets = this.nlqFilterService.queryInvolvesTickets(this.queryText());
    if (needsTickets && !this._ticketsReady()) {
      this.waitingForTickets.set(true);
      return;
    }

    // Same for DP: park on its own spinner until the fetch lands rather than filtering against an
    // empty array, which reads as a genuine "no producers found".
    if (this.nlqFilterService.queryInvolvesDpContracts(this.queryText()) && !this._dpReady()) {
      this.waitingForDp.set(true);
      this._ensureDpForQuery();
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

    // If the query reads notes and the slice it needs (windowed or full) hasn't landed yet, wait —
    // otherwise the NLQ would run against zero notes and paint a false "no results".
    // _dataReadyEffect re-runs this filter once the notes arrive (or the fetch gives up).
    if (needsNotes && !this._notesReadyForQuery()) {
      this.waitingForNotes.set(true);
      return;
    }

    // All needed data is in hand — run the NLQ immediately.
    this.waitingForTickets.set(false);
    this.waitingForNotes.set(false);
    this.waitingForDp.set(false);
    // Coverage queries finish asynchronously and clear isProcessing themselves — clearing it here
    // would drop the spinner and paint the unfiltered list until their fetch resolves.
    if (!this._applyNlqFilter()) this.isProcessing.set(false);
  }

  /** The note load the CURRENT prompt needs — see noteScope in utils/note-filters. */
  private _noteScope(r: RefinementFilters = this.appliedRefinements()): NoteScope {
    return noteScope(r, this.queryText(), this._queryGenId, {
      searchKeywords: q => this.nlqFilterService.extractNoteSearchKeywords(q),
      authorCandidates: () => this._authorCandidates(),
    });
  }

  /** True when the notes this prompt needs for display are already loaded. Batched prompts never
   *  block — their set comes from the aggregate and note bodies stream in per render batch. */
  private _notesReadyForQuery(r: RefinementFilters = this.appliedRefinements()): boolean {
    const scope = this._noteScope(r);
    if (scope.mode === 'none' || scope.mode === 'batched') return true;
    if (scope.mode === 'full') return this.appState.notesLoaded();
    return this._loadedNoteScopeKey() === scope.key;
  }

  /** Loads the notes the current prompt needs: full set (shared cache) for full-mode; a
   *  server-narrowed slice (local) for scoped; nothing here for batched (the batch effect loads
   *  note bodies per render batch). No-op when nothing's needed or the slice is already present. */
  /**
   * Fetches DP rows once for the current trade units if they haven't been loaded. Warms the shared
   * appState cache so other pages skip the download, and flips dpContractsLoaded even on failure /
   * empty so a DP-less trade unit can't park the spinner forever.
   */
  private _ensureDpForQuery(): void {
    if (this._dpReady() || this._dpFetchInFlight) return;
    // The TU preload may already have filled the shared cache while this page's local copy is empty.
    // Adopt it rather than re-fetching the same rows.
    if (this.appState.dpContractsLoaded()) {
      this.dpContracts.set(this.appState.dpContracts());
      this._dpReady.set(true);
      return;
    }
    this._dpFetchInFlight = true;
    const tu = this.appState.selectedTradeUnits();
    const tuParam = tu.length > 0 ? tu : undefined;
    // Capture the trade units this fetch is for. DataPreloadService clears the shared DP cache
    // reactively on a trade-unit change; if the user switches while this request is in flight, the
    // reset fires first and then a stale response would write the OLD trade unit's rows back into
    // a cache the whole app reads, flipping dpContractsLoaded with the wrong data.
    const fetchedForTu = tu.join(',');
    const isStale = () => this.appState.selectedTradeUnits().join(',') !== fetchedForTu;

    this.apiService.getDpContracts(tuParam).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this._dpFetchInFlight = false;
        if (isStale()) return;
        this.dpContracts.set(data ?? []);
        this.appState.setDpContracts(data ?? []);  // also flips dpContractsLoaded
        this.appState.setDpContractsLoadFailed(false);
        this._dpReady.set(true);                   // re-triggers _dataReadyEffect to run the query
      },
      error: () => {
        this._dpFetchInFlight = false;
        if (isStale()) return;
        this.dpContracts.set([]);
        this.appState.setDpContracts([]);          // loaded-but-empty, not "still loading"
        this.appState.setDpContractsLoadFailed(true); // ...and says so, or a DP prompt answers "none"
        this._dpReady.set(true);
      }
    });
  }

  private _ensureNotesForQuery(r: RefinementFilters = this.appliedRefinements()): void {
    const scope = this._noteScope(r);
    if (scope.mode === 'none' || scope.mode === 'batched') return;
    if (scope.mode === 'full') { this._ensureNotesLoaded(); return; }
    if (this._loadedNoteScopeKey() === scope.key) return;
    // A different scope is mid-flight. Hold this request instead of dropping it:
    // _ensureDataForCriteria is called exactly once when a refine is staged and nothing re-kicks
    // it, so a swallowed call left _criteriaReadiness false forever for that staged refine —
    // spinner on, Apply disabled — until the user happened to change something else.
    if (this._scopedNotesFetchInFlight) {
      this._supersededNoteScopeRequest = r;
      return;
    }
    this._scopedNotesFetchInFlight = true;
    const tu = this.appState.selectedTradeUnits();
    // Author ("by me") fetches are NOT TU-filtered: a by-me note on a LINKED producer in another TU
    // still counts (same reason batched mode omits TU), and the by-me set is small so it's free to
    // fetch all. Other scoped fetches (content / window / pinned) keep the TU scope.
    const tuParam = scope.opts.authorAny ? undefined : (tu.length > 0 ? tu : undefined);
    this.apiService.getNotes(tuParam, scope.opts).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this._scopedNotesFetchInFlight = false;
        this.notes.set(data ?? []);            // DISPLAY only — do NOT warm the full-set cache
        this._loadedNoteScopeKey.set(scope.key); // re-triggers _dataReadyEffect (via notes()) to run the query
        this._retryScopedNotesIfSuperseded();
      },
      error: () => {
        this._scopedNotesFetchInFlight = false;
        this.notes.set([]);
        this._loadedNoteScopeKey.set(scope.key);
        this._retryScopedNotesIfSuperseded();
      }
    });
  }

  /** Re-runs a scoped-note fetch that was superseded while another was in flight, with the
   *  refinements it originally asked for. Cleared before the retry so a failing fetch can't loop. */
  private _retryScopedNotesIfSuperseded(): void {
    const pending = this._supersededNoteScopeRequest;
    if (!pending) return;
    this._supersededNoteScopeRequest = null;
    this._ensureNotesForQuery(pending);
  }

  /** Batched note loading: fetch note bodies for the producers in the current render window (and
   *  their linked-producer components) by customerId, accumulating into this.notes() as the user
   *  scrolls — so a huge "everyone with notes" list never waits on all 28.8k notes up front. Only
   *  used by the 'batched' scope; serialized via _batchNotesFetchInFlight, and it re-checks after
   *  each fetch to pick up producers that rendered while it was in flight. */
  private _loadNotesForRenderedBatch(): void {
    if (this._noteScope().mode !== 'batched' || this._batchNotesFetchInFlight) return;
    const codeToId = new Map<string, number>();
    for (const c of this.customers()) if (c.scoularId) codeToId.set(c.scoularId, c.id);
    const components = this.linkedProducerComponents();
    const needed = new Set<number>();
    for (const c of this.renderedCustomers()) {
      if (!this._batchedNoteCustomerIds.has(c.id)) needed.add(c.id);
      const codes = c.scoularId ? components.get(c.scoularId) : null;
      if (codes) for (const code of codes) {
        const id = codeToId.get(code);
        if (id != null && !this._batchedNoteCustomerIds.has(id)) needed.add(id);
      }
    }
    if (needed.size === 0) return;
    const ids = [...needed];
    this._batchNotesFetchInFlight = true;
    // No trade-unit filter — like the full-set load and the last-contact aggregate, fetch ALL
    // notes for these customerIds so a linked producer's note in an unselected TU is never missed.
    this.apiService.getNotes(undefined, { customerIds: ids }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this._batchNotesFetchInFlight = false;
        for (const id of ids) this._batchedNoteCustomerIds.add(id);
        const seen = new Set(this.notes().map(n => n.id));
        const fresh = (data ?? []).filter(n => !seen.has(n.id));
        if (fresh.length) this.notes.set([...this.notes(), ...fresh]);
        this._loadNotesForRenderedBatch(); // pick up any producers rendered during the fetch
      },
      error: () => {
        this._batchNotesFetchInFlight = false;
        for (const id of ids) this._batchedNoteCustomerIds.add(id); // don't retry-loop on a failed id set
      }
    });
  }

  /** One-shot background fetch of the full note set into the shared lazy cache. No-op if the
   *  cache is already warm or a fetch is in flight (ApiService also dedupes the request). On
   *  completion it writes both appState.notes and the local signal, which re-triggers
   *  _dataReadyEffect to run the parked query. On error it marks the cache loaded (empty) so
   *  the spinner clears and the query proceeds rather than hanging. */
  private _ensureNotesLoaded(): void {
    if (this.appState.notesLoaded()) {
      // Cache warm elsewhere (home/customer-list) — sync the local signal if we missed it.
      if (this.notes().length !== this.appState.notes().length) this.notes.set(this.appState.notes());
      return;
    }
    if (this._notesFetchInFlight) return;
    this._notesFetchInFlight = true;
    this.apiService.getNotes().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this._notesFetchInFlight = false;
        const list = data ?? [];
        this.appState.setNotes(list); // sets notesLoaded = true
        this.notes.set(list);         // re-triggers _dataReadyEffect
      },
      error: () => {
        this._notesFetchInFlight = false;
        // Give up rather than strand the spinner — run against an empty set (genuine no-match).
        this.appState.setNotes([]);
        this.notes.set([]);
      }
    });
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
    const needsDp = this.nlqFilterService.queryInvolvesDpContracts(query);
    const needsNotes = this.noteFilterActive();
    const ticketsOk = !needsTickets || this._ticketsReady();
    const storageOk = !needsStorage || this._storageReady();
    const dpOk = !needsDp || this._dpReady();
    const notesOk = !needsNotes || this.notes().length > 0;
    // The full note set is only required for prompts/refines that actually read note content,
    // authors, or pinned flags (noteFilterActive). Recency filtering uses the last-contact
    // aggregate and non-note prompts never touch notes, so neither waits on the full set.
    // notesLoaded (not length) distinguishes "not fetched" from "TU genuinely has none".
    const notesReady = !needsNotes || this.appState.notesLoaded();
    if (tusMatch && this.coreDataLoaded() && this.customers().length > 0 && ticketsOk && storageOk && dpOk && notesOk && notesReady) {
      this._resolvePendingIncludes();
      // Async coverage queries own isProcessing until their fetch resolves (see _applyNlqFilter).
      if (!this._applyNlqFilter()) this.isProcessing.set(false);
      return;
    }

    const tuParam = tradeUnits.length > 0 ? tradeUnits : undefined;
    // Only hit the notes endpoint when this query/refine actually needs note content AND the
    // shared cache is cold — otherwise reuse (or skip) it. Non-note and recency-only prompts
    // never download the full set.
    const fetchingNotes = needsNotes && !this.appState.notesLoaded();
    let ticketFetchFailed = false;
    forkJoin({
      customers: this.apiService.getCustomers(tuParam).pipe(
        tap(() => this.appState.setCustomersLoadFailed(false)),
        catchError(() => { this.appState.setCustomersLoadFailed(true); return of([] as Customer[]); })),
      contracts: this.apiService.getContracts(tuParam).pipe(
        tap(() => this.appState.setContractsLoadFailed(false)),
        catchError(() => { this.appState.setContractsLoadFailed(true); return of([] as Contract[]); })),
      tickets: this.apiService.getTickets(tuParam).pipe(
        tap(() => this.appState.setTicketsLoadFailed(false)),
        catchError(() => { ticketFetchFailed = true; return of([] as Ticket[]); })),
      plantingIntentions: this.apiService.getPlantingIntentions(tuParam).pipe(
        tap(() => this.appState.setPlantingIntentionsLoadFailed(false)),
        catchError(() => { this.appState.setPlantingIntentionsLoadFailed(true); return of([] as PlantingIntention[]); })),
      notes: fetchingNotes
        ? this.apiService.getNotes().pipe(catchError(() => of([] as Note[])))
        : of(this.appState.notes()),
      storedGrain: this.apiService.getStoredGrain(tuParam).pipe(catchError(() => of([] as StoredGrain[]))),
      dpContracts: this.apiService.getDpContracts(tuParam).pipe(
        tap(() => this.appState.setDpContractsLoadFailed(false)),
        catchError(() => { this.appState.setDpContractsLoadFailed(true); return of([] as DpContract[]); })),
      producerDetails: (this.appState.producerDetails().length > 0 ? of(this.appState.producerDetails()) : this.apiService.getAllProducerDetails()).pipe(catchError(() => of([] as ProducerDetails[])))
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        if (queryGen !== this._queryGenId) return; // Superseded by a newer query
        this.customers.set(data.customers);
        this._mergeProducerDetails(data.producerDetails);
        this.contracts.set(data.contracts);
        this.tickets.set(data.tickets);
        this.appState.setTicketsLoadFailed(ticketFetchFailed && data.tickets.length === 0);
        this.notes.set(data.notes);
        // Warm the shared lazy cache so other consumers (home enrichment, customer-list
        // saved lists) and this page's next query skip the download.
        if (fetchingNotes) this.appState.setNotes(data.notes);
        this.plantingIntentions.set(data.plantingIntentions);
        this.storedGrain.set(data.storedGrain);
        this.dpContracts.set(data.dpContracts);
        this.appState.setDpContracts(data.dpContracts);
        this._dpReady.set(true);
        this._ticketsReady.set(true);
        this._storageReady.set(true);
        this.coreDataLoaded.set(true);
        this._resolvePendingIncludes();

        // Async coverage queries own isProcessing until their fetch resolves (see _applyNlqFilter).
        if (!this._applyNlqFilter()) this.isProcessing.set(false);
      },
      error: () => {
        if (queryGen !== this._queryGenId) return;
        this.toastService.error('Failed to load data for query');
        this.isProcessing.set(false);
        // Nothing more is coming, so the recovery effect will never clear these — drop the
        // spinners here or the failure reads as an endless load.
        this.waitingForTickets.set(false);
        this.waitingForNotes.set(false);
        this.waitingForDp.set(false);
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
    const resolved = this._pendingIncludedIds
      .map(id => customerMap.get(id))
      .filter((c): c is Customer => !!c);
    // KEEP the ids this roster can't resolve. A producer hand-added under a trade unit that isn't
    // loaded right now has to survive until a roster containing them loads — and _allIncludedCustomerIds
    // re-persists them meanwhile. Dropping them here is what silently lost hand-added producers
    // whenever a list was re-saved while a different trade unit was selected.
    this._pendingIncludedIds = this._pendingIncludedIds.filter(id => !customerMap.has(id));
    if (resolved.length === 0) return;
    const known = new Set(this.manuallyIncludedCustomers().map(c => c.id));
    const added = resolved.filter(c => !known.has(c.id));
    if (added.length > 0) this.manuallyIncludedCustomers.update(list => [...list, ...added]);
    // Auto-open panel now that included customers are resolved
    this.showManageMembersPanel.set(true);
  }

  /** Every producer hand-added to the active list: those resolved against the loaded roster PLUS any
   *  still-unresolved ids (members whose trade unit isn't currently loaded). Persist this, never the
   *  resolved half alone, or saving under a different trade unit erases the rest. */
  private _allIncludedCustomerIds(): number[] {
    return [...this.manuallyIncludedCustomers().map(c => c.id), ...this._pendingIncludedIds];
  }

  private _resolveUserReferences(query: string): string {
    const account = this.msalService.instance.getActiveAccount()
      ?? this.msalService.instance.getAllAccounts()[0];
    return this.nlqFilterService.resolveUserReferences(query, account?.name ?? '', account?.username ?? '');
  }

  /** Runs the NLQ filter against the current in-memory data and updates filteredCustomers.
   *  Returns TRUE when it instead handed off to an asynchronous path that publishes its own result
   *  later — the caller must then leave `isProcessing` set, or the unfiltered list paints while the
   *  fetch is still in flight. */
  private _applyNlqFilter(): boolean {
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
      noteLastContacts: this.appState.noteLastContacts(),
      myReminders: this.appState.myReminders(),
      plantingIntentions: this.plantingIntentions(),
      storedGrain: this.storedGrain(),
      dpContracts: this.dpContracts(),
      commodities: this.appState.commodities(),
      commodityConversions: this.appState.commodityConversions(),
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
    // waitingForTickets must depend ONLY on whether the fetch has RESOLVED — never on emptiness.
    // _dataReadyEffect reads waitingForTickets() in its condition and runs _applyNlqFilter() from
    // inside itself; re-asserting waitingForTickets=true on an empty-but-resolved ticket set (a TU
    // with no tickets, or a timed-out fetch) re-dirties that effect on every run → infinite loop /
    // hard freeze. This bit only ticket prompts, since they were the sole path re-asserting a wait
    // flag on emptiness. Once _ticketsReady is true the fetch is done (empty = genuine no-tickets);
    // a late appState backfill is still picked up by _appStateTicketsEffect, which re-runs the filter.
    this.waitingForTickets.set(queryNeedsTickets && !this._ticketsReady());
    // The no-match banner keeps the original emptiness guard so a "0 producers" flash is suppressed
    // during the empty-then-backfill window — this is display-only and NOT a _dataReadyEffect
    // dependency, so it can't feed the loop above.
    const ticketsPendingForBanner = queryNeedsTickets && (!this._ticketsReady() || this.tickets().length === 0);
    // Same guard for notes: if the query reads notes but the lazy set isn't loaded yet, treat
    // it as pending (not a zero-match) so we don't flash "no results" before the fetch lands.
    // _dataReadyEffect re-runs this filter once notes arrive.
    const notesPending = this.noteFilterActive() && !this._notesReadyForQuery();
    this.waitingForNotes.set(notesPending);
    // Ensure the fetch is actually in flight. processQuery starts it before parking a query,
    // but direct callers of _applyNlqFilter (the restore/background-refresh at _loadFresh and
    // the appState-tickets effect) bypass processQuery — without this the "Loading note data…"
    // spinner would hang with nothing fetching. Idempotent: no-ops if the needed slice is present
    // or a fetch is already in flight.
    if (notesPending) this._ensureNotesForQuery();

    const lq = this.queryText().toLowerCase();

    // Planting-coverage queries are resolved ASYNCHRONOUSLY (base.Contract per crop year + that
    // season's yield targets), so hand off before publishing anything. The NLQ engine doesn't
    // recognise these phrasings and returns essentially every producer, so setting filteredCustomers
    // here first painted the whole list until the fetch landed — a visible flash of wrong results.
    // Returning true tells the caller to leave isProcessing alone; the async path owns it now.
    const isCoverageQuery = (lq.includes('planting') && (lq.includes('no contract') || lq.includes('no active contract')))
      || lq.includes('percent contracted') || lq.includes('uncontracted');
    if (isCoverageQuery) {
      this._applyPlantingCoverageFilter(lq);
      return true;
    }

    // The blank-start card is INTENTIONALLY empty — suppress the generic "no match" banner in
    // favor of the dedicated one pointing at Manage Members (same suppression pattern as
    // contractsUnavailableForQuery / coverageNeedsYieldTargets).
    this.queryReturnedNoMatches.set(
      result.customers.length === 0 && !ticketsPendingForBanner && !notesPending && !this.isBlankStartQuery());
    this.filteredCustomers.set(result.customers);

    // If the query mentions pacing, apply direction filtering here at the component level
    // Harvest-window-based pacing direction — overrides the NLQ service's internal pacing
    // calculation with the same logic the customer profile pacing card uses.
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

    return false;
  }



  getStateDisplayName(state: string): string {
    return this.nlqFilterService.getStateDisplayName(state);
  }

  loadSavedList(list: SavedList, source: 'saved' | 'team' = 'saved'): void {
    if (this.loading() || this.isProcessing()) {
      // Don't drop the click silently — tell the user why nothing happened so they aren't
      // wondering whether the click landed. The processing spinner is already on screen but
      // can be easy to miss if focus is on the library panel.
      this.toastService.info('Still loading — please wait a moment and try again');
      return;
    }
    this.usageTracking.postClickEvent('interaction', 'build-a-list',
      source === 'team' ? 'team-list-loaded' : 'saved-list-loaded', list.id.toString());
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
    // Run against the CURRENTLY selected trade units, not the ones the list was saved under: a
    // saved list is a reusable question, so the same list can be re-run under whatever trade unit
    // the user has switched to. (This is how the home page has always run saved lists.)
    this.processQuery(this.effectiveTradeUnits());
  }

  /** Are all datasets the given (current query text + refinements) pair needs RESOLVED? Never
   *  keys off emptiness — only fetch resolution — so a trade unit with genuinely zero rows in a
   *  dataset still reports ready (matches the doctrine _ticketsReady/_contractsReady/_dpReady/
   *  _storageReady/_notesReadyForQuery already follow). Used by _commitRefinements to decide
   *  whether a refine change can apply immediately or must stage and wait. */
  private _criteriaReadiness(r: RefinementFilters = this.appliedRefinements()): boolean {
    const needs = this.nlqFilterService.dataNeedsForCriteria(this.queryText(), r);
    if (needs.tickets && !this._ticketsReady()) return false;
    if (needs.contracts && !this._contractsReady()) return false;
    if (needs.storage && !this._storageReady()) return false;
    if (needs.dp && !this._dpReady()) return false;
    // _notesReadyForQuery already encodes the note-scope nuance (none/full/batched/scoped) that
    // dataNeedsForCriteria's fullNotes flag alone can't — reuse it rather than duplicating that.
    if (!this._notesReadyForQuery(r)) return false;
    return true;
  }

  /** Idempotently starts whatever fetches the given criteria need but don't already have one in
   *  flight. Tickets/contracts/storage have no on-demand fetch of their own — they're already in
   *  flight from _loadFresh — so only notes and DP have anything to kick here. */
  private _ensureDataForCriteria(r: RefinementFilters = this.appliedRefinements()): void {
    if (isNoteFilterActive(r, this.queryText())) this._ensureNotesForQuery(r);
    if (this.nlqFilterService.dataNeedsForCriteria(this.queryText(), r).dp) this._ensureDpForQuery();
  }

  /** Reconciles this.notes()/_loadedNoteScopeKey/_batchedNoteCustomerIds with the note scope the
   *  CURRENT (just-committed) appliedRefinements imply. Fixes two gaps a bare
   *  appliedRefinements.set() would leave: (1) _ensureNotesLoaded()'s equal-length blind spot
   *  when a scoped slice happens to match the full set's length, and (2) a scope-mode change
   *  (e.g. unchecking "pinned" drops back to 'batched') that doesn't change result MEMBERSHIP, so
   *  the membership-keyed render-reset effect never fires to clear the stale slice. Called after
   *  every appliedRefinements commit. */
  private _syncNoteSliceToScope(): void {
    const scope = this._noteScope();
    if (scope.mode === 'scoped') {
      if (this._loadedNoteScopeKey() !== scope.key) this._ensureNotesForQuery();
    } else if (scope.mode === 'full') {
      if (this._loadedNoteScopeKey() !== '') {
        this.notes.set(this.appState.notes());
        this._loadedNoteScopeKey.set('');
      }
      this._ensureNotesLoaded();
    } else if (scope.mode === 'batched') {
      if (this._loadedNoteScopeKey() !== '') {
        this.notes.set([]);
        this._batchedNoteCustomerIds.clear();
        this._loadedNoteScopeKey.set('');
      }
    }
    // 'none' — no-op.
  }

  /** Single commit point for appliedRefinements — applyFilters, clearRefinements, and the
   *  immediate-apply crop/state chips all route through this. Commits immediately when every
   *  dataset the new criteria read is already resolved (the common case, identical to the old
   *  synchronous behavior). When a dataset the new criteria need is NOT yet resolved — e.g. a
   *  crop chip that scopes to Storage but storedGrain hasn't loaded, or a note refine needing a
   *  server-narrowed slice that hasn't been fetched — it STAGES the criteria, starts the fetch,
   *  and leaves the OLD (data-backed) results on screen; _refineReadyEffect commits once the
   *  fetch resolves. This is what stops a refine change from ever filtering against a partial
   *  dataset and silently returning near-zero results — the exact "the state/commodity filter
   *  doesn't filter" symptom this was built to fix. It deliberately does NOT re-run the NLQ:
   *  refinements narrow filteredCustomers, they don't change it, so there's nothing to re-parse. */
  private _commitRefinements(next: RefinementFilters): void {
    const staged = { ...next };
    if (this._criteriaReadiness(staged)) {
      this._pendingApplyCriteria.set(null);
      this.appliedRefinements.set(staged);
      this._syncNoteSliceToScope();
      return;
    }
    this._pendingApplyGen = this._queryGenId; // no ++ — the note-scope key embeds the CURRENT gen
    this._pendingApplyCriteria.set(staged);
    this._ensureDataForCriteria(staged);
  }

  clearRefinements(): void {
    this.pendingRefinements.set({});
    this.notContactedDaysInput.set('');
    this._commitRefinements({});
  }

  applyNotContactedDays(): void {
    const days = parseInt(this.notContactedDaysInput(), 10);
    this.updateRefinement(r => ({ ...r, notContactedDays: isNaN(days) || days <= 0 ? null : days }));
  }

  /** Single entry point for every refine-panel input (checkboxes, number fields, chips) — updates
   *  the pending draft AND immediately commits it, so no separate "Apply Filters" click is
   *  needed. Routes through the same _commitRefinements staging/readiness protection the crop/
   *  state chips already used: if the new criteria need data that hasn't loaded yet, the old
   *  (data-backed) results stay on screen while it fetches rather than flashing a false
   *  near-empty result. Takes the same updater-function shape as Signal.update() so every
   *  template binding that used to call `pendingRefinements.update(...)` now calls this instead. */
  updateRefinement(updater: (r: RefinementFilters) => RefinementFilters): void {
    const next = updater(this.pendingRefinements());
    this.pendingRefinements.set(next);
    this._commitRefinements(next);
  }

  /** Crop chips apply immediately on click (cheap, client-side narrowing) — routed through
   *  _commitRefinements like every other refine change so a chip that happens to need
   *  not-yet-loaded dimension data (e.g. scoping to Storage) stages and waits instead of
   *  silently filtering to near-zero. */
  togglePendingCrop(crop: string): void {
    const current = this.pendingRefinements().crops ?? [];
    const updated = current.includes(crop) ? current.filter(c => c !== crop) : [...current, crop];
    const next = { ...this.pendingRefinements(), crops: updated.length > 0 ? updated : undefined };
    this.pendingRefinements.set(next);
    this._commitRefinements(next);
  }

  /** State chips apply immediately on click — see togglePendingCrop. */
  togglePendingState(state: string): void {
    const current = this.pendingRefinements().states ?? [];
    const updated = current.includes(state) ? current.filter(s => s !== state) : [...current, state];
    const next = { ...this.pendingRefinements(), states: updated.length > 0 ? updated : undefined };
    this.pendingRefinements.set(next);
    this._commitRefinements(next);
  }

  isCropSelected(crop: string): boolean {
    return !!(this.pendingRefinements().crops?.includes(crop));
  }

  isStateSelected(state: string): boolean {
    return !!(this.pendingRefinements().states?.includes(state));
  }

  /** Delivery Location chips apply immediately on click — see togglePendingCrop. Picking one
   *  needs tickets loaded (elevatorCity lives on Ticket, not Customer); _commitRefinements
   *  stages and waits via _criteriaReadiness/dataNeedsForCriteria if they haven't landed yet. */
  togglePendingDeliveryLocation(location: string): void {
    const current = this.pendingRefinements().deliveryLocations ?? [];
    const updated = current.includes(location) ? current.filter(l => l !== location) : [...current, location];
    const next = { ...this.pendingRefinements(), deliveryLocations: updated.length > 0 ? updated : undefined };
    this.pendingRefinements.set(next);
    this._commitRefinements(next);
  }

  isDeliveryLocationSelected(location: string): boolean {
    return !!(this.pendingRefinements().deliveryLocations?.includes(location));
  }

  // ── Manage Members methods ─────────────────────────────────────────────

  /** Matches from current displayed results (available to exclude). */
  memberInResultsMatches = signal<Customer[]>([]);

  searchMembers(term: string): void {
    if (this._memberSearchTimeout) clearTimeout(this._memberSearchTimeout);
    if (!term.trim() || term.trim().length < 2) {
      // Cancel here too, not just on the search path below: clearing the box only stopped a
      // request still inside the debounce, so one already in flight would land afterwards and
      // repopulate the list the user just emptied.
      this._cancelMemberSearch$.next();
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
    // Cancel a search that already left the debounce. clearTimeout only stops a request that
    // hasn't fired yet; without this, typing "abc" then "abcd" leaves two requests racing and
    // whichever resolves last wins, so the list could settle on results for the abandoned term.
    this._cancelMemberSearch$.next();
    this._memberSearchTimeout = setTimeout(() => {
      const tus = this.effectiveTradeUnits();
      this.apiService.searchCustomers(term, tus.length > 0 ? tus : undefined)
        .pipe(takeUntil(this._cancelMemberSearch$), takeUntilDestroyed(this.destroyRef))
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
    // Drop any unresolved hand-add for this producer too, so removing them sticks even if a copy is
    // still parked in the pending set from a trade unit that wasn't loaded.
    this._pendingIncludedIds = this._pendingIncludedIds.filter(id => id !== customerId);
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

  /** Harvest-window pacing direction for one producer — see customerPacingDirection (utils). */
  private _getCustomerPacingDirection(customer: Customer): 'up' | 'down' | 'flat' | null {
    const customerContracts = this._contractsByCustomer().get(customer.scoularId!) || [];
    // Checked here as well as in customerPacingDirection so a producer with no contracts never
    // reads the harvest windows (the same dependencies as before the logic moved out).
    if (customerContracts.length === 0) return null;
    return customerPacingDirection(customerContracts, this.appState.harvestWindows());
  }

  /**
   * Fetches contracts from base.Contract for each planting year, then applies coverage logic.
   * Used by "0% coverage", "under 50% contracted", and "highest uncontracted" queries.
   */
  private _applyPlantingCoverageFilter(lq: string): void {
    // These two early exits must clear isProcessing themselves: the caller now leaves it set for
    // coverage queries (so the unfiltered list can't flash), so bailing without clearing it would
    // strand the spinner with no fetch in flight.
    this.coverageNeedsYieldTargets.set(false);
    const intentions = this.plantingIntentions();
    if (intentions.length === 0) {
      this.filteredCustomers.set([]);
      this.queryReturnedNoMatches.set(true);
      this.isProcessing.set(false);
      return;
    }

    // Unique planting years to fetch
    const years = [...new Set(intentions.map(p => p.plantingYear).filter(Boolean))];
    if (years.length === 0) {
      this.filteredCustomers.set([]);
      this.queryReturnedNoMatches.set(true);
      this.isProcessing.set(false);
      return;
    }

    this.isProcessing.set(true);
    const tuParam = this.appState.selectedTradeUnits();
    const tus = tuParam.length > 0 ? tuParam : undefined;

    // Fetch contracts AND the season yield targets for each planting year in parallel. The
    // estimates used to come from appState.dashboardCache(), which is only populated by visiting the
    // Planting Intentions dashboard and holds a single year — so coverage prompts silently depended
    // on where the user had browsed, and applied one year's yield to every year's acres.
    const tuKey = [...tuParam].sort().join(',');
    forkJoin({
      contracts: forkJoin(years.map(y => this.apiService.getContractsByCropYear(y, tus).pipe(
        // Flagged rather than silently empty: this feeds the planting-coverage view, where [] reads as
        // "nobody has contracts for this crop year".
        catchError(() => { this.appState.setContractsLoadFailed(true); return of([] as Contract[]); })
      ))),
      estimates: tuKey
        ? forkJoin(years.map(y => this.apiService.getDashboardPlantingEstimates(tuKey, y).pipe(
            catchError(() => of([] as DashboardPlantingEstimate[]))
          )))
        : of([] as DashboardPlantingEstimate[][]),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ contracts: results, estimates: estimateBatches }) => {
      const coverage = evaluatePlantingCoverage(lq, {
        intentions,
        customers: this.customers(),
        contractBatches: results,
        estimateBatches,
        commodities: this.appState.commodities(),
        commodityConversions: this.appState.commodityConversions(),
      });
      if (coverage.customers) this.filteredCustomers.set(coverage.customers);

      const noResults = this.filteredCustomers().length === 0;
      const missingYieldTargets = noResults && coverage.plantingRowsEvaluated > 0 && coverage.plantingRowsWithEstimate === 0;
      this.coverageNeedsYieldTargets.set(missingYieldTargets);
      // Suppress the generic "no match" banner in favor of the yield-target-specific one —
      // same pattern as contractsUnavailableForQuery/ticketsUnavailableForQuery suppressing it
      // in favor of their retry panels.
      this.queryReturnedNoMatches.set(noResults && !missingYieldTargets);
      this.isProcessing.set(false);
    });
  }

  readonly hasAnyRefinement = hasAnyRefinement;

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

  /** The current list as a saved-list body (query, trade units, refinements + prompt category,
   *  member overrides) — see buildSavedListPayload. */
  private _listPayload(): SavedListPayload {
    return buildSavedListPayload({
      query: this.queryText(),
      tradeUnits: this.effectiveTradeUnits(),
      refinements: this.activeRefinementCount() > 0 ? this.appliedRefinements() : null,
      category: this.effectiveLibraryCategory(),
      includedIds: this._allIncludedCustomerIds(),
      excludedIds: [...this.manuallyExcludedCustomerIds()],
    });
  }

  saveList(): void {
    if (!this.newListName().trim() || this.displayedCustomers().length === 0) return;
    this.usageTracking.postClickEvent('interaction', 'build-a-list', 'save-list');

    const payload = { name: this.newListName(), ...this._listPayload() };

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
        this._refreshTeamLists(); // a manager may have edited a teammate's list
      },
      error: () => {
        this.toastService.error('Failed to save list');
      }
    });
  }

  // ── "Build a list for a team member" flow (member-first) ─────────────────
  // 1) Pick the member(s) → enter "building for" mode (banner). 2) Build the list normally.
  // 3) "Assign to N" finalizes: one copy per member, shown in their Saved Lists + your Team Lists.

  /** Step 1: open the member picker for the current trade unit(s). Requires an explicit TU selection
   *  (members are scoped to it). */
  openBuildForMembersPicker(): void {
    const tus = this.appState.selectedTradeUnits();
    if (tus.length === 0) return;
    this.assignTargetIds.set(new Set());
    this.teamMembers.set([]);
    this.showBuildForDialog.set(true);
    this.teamMembersLoading.set(true);
    this.apiService.getTeamMembers(tus.join(',')).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (members) => { this.teamMembers.set(members); this.teamMembersLoading.set(false); },
      error: () => { this.teamMembersLoading.set(false); this.toastService.error('Failed to load team members'); }
    });
  }

  closeBuildForDialog(): void {
    this.showBuildForDialog.set(false);
  }

  /** Step 1 confirm: lock in the chosen members and start building a fresh list for them. */
  startBuildingForMembers(): void {
    const chosen = this.teamMembers().filter(m => this.assignTargetIds().has(m.userId));
    if (chosen.length === 0) return;
    this.buildingForMembers.set(chosen);
    this.showBuildForDialog.set(false);
    // Fresh canvas so they build the list specifically for these members.
    this.clearQuery();
    this.selectedCategory.set(null);
  }

  /** Cancel the "building for" mode: clears the in-progress query/results and returns to the Team
   *  Lists view. Does not touch any already-assigned lists. */
  cancelBuildForMembers(): void {
    this.buildingForMembers.set([]);
    this.clearQuery();            // close any open prompt/results and reset refinements
    this.selectedCategory.set('Team Lists');
  }

  /** Step 3: finalize — open the naming/confirm dialog with the locked-in members pre-selected. */
  openFinalizeAssign(): void {
    if (this.buildingForMembers().length === 0 || this.displayedCustomers().length === 0) return;
    this._assignBase = this._listPayload();
    // Members already chosen — show them in the dialog, all selected; manager just names + confirms.
    this.teamMembers.set(this.buildingForMembers());
    this.assignTargetIds.set(new Set(this.buildingForMembers().map(m => m.userId)));
    this.assignListName.set(this.activeSavedList()?.name ?? this.queryText());
    this.showAssignDialog.set(true);
  }

  /** Opens the assign dialog seeded from an EXISTING saved/team list (the row "Assign to…" action). */
  openAssignExistingList(list: SavedList): void {
    this._assignBase = {
      query: list.query,
      tradeUnits: list.tradeUnits,
      filters: list.filters,
      includedCustomerIds: list.includedCustomerIds,
      excludedCustomerIds: list.excludedCustomerIds,
    };
    this._openAssignDialog(list.name, list.tradeUnits ?? this.effectiveTradeUnits().join(','));
  }

  private _openAssignDialog(name: string, tradeUnitsCsv: string): void {
    this.assignListName.set(name);
    this.assignTargetIds.set(new Set());
    this.teamMembers.set([]);
    this.showAssignDialog.set(true);

    const tus = tradeUnitsCsv?.trim();
    if (!tus) return;
    this.teamMembersLoading.set(true);
    this.apiService.getTeamMembers(tus).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (members) => { this.teamMembers.set(members); this.teamMembersLoading.set(false); },
      error: () => { this.teamMembersLoading.set(false); this.toastService.error('Failed to load team members'); }
    });
  }

  closeAssignDialog(): void {
    this.showAssignDialog.set(false);
    this._assignBase = null;
  }

  toggleAssignTarget(userId: string): void {
    this.assignTargetIds.update(set => {
      const next = new Set(set);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }

  confirmAssign(): void {
    const base = this._assignBase;
    const targets = [...this.assignTargetIds()];
    const name = this.assignListName().trim();
    if (!base || targets.length === 0 || !name || this.assigning()) return;

    const wasBuildFor = this.buildingForMembers().length > 0;
    this.assigning.set(true);
    this.usageTracking.postClickEvent('interaction', 'build-a-list', 'assign-list');
    this.apiService.assignSavedList({ ...base, name, targetUserIds: targets })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (created) => {
          this.assigning.set(false);
          this.showAssignDialog.set(false);
          this._assignBase = null;
          this.buildingForMembers.set([]); // exit "building for" mode if active
          this.toastService.success(`Assigned "${name}" to ${created.length} member${created.length === 1 ? '' : 's'}`);
          // After the member-first build-for flow, reset the canvas and drop the manager back on
          // Team Lists so they see the new "For [member]" entry rather than the list they just built.
          if (wasBuildFor) {
            this.clearQuery();
            this.selectedCategory.set('Team Lists');
          }
          this._refreshTeamLists();
        },
        error: () => {
          this.assigning.set(false);
          this.toastService.error('Failed to assign list');
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

    // Remove from local arrays immediately for instant UI feedback. The id may live in either the
    // user's own lists (savedLists) or, for a manager, a teammate's list (teamSavedLists).
    this.savedLists.update(lists => lists.filter(l => l.id !== listId));
    this.teamSavedLists.update(lists => lists.filter(l => l.id !== listId));
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
        this._refreshTeamLists();
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

  /** Reloads the manager-only team lists for the given trade units (defaults to the explicitly
   *  selected trade unit(s) — not effectiveTradeUnits(), to avoid surfacing other groups' lists).
   *  Silent on failure — the team view is supplementary to the user's own saved lists. */
  private _refreshTeamLists(tus: string[] = this.appState.selectedTradeUnits()): void {
    if (!this.isManager() || tus.length === 0) {
      this.teamSavedLists.set([]);
      return;
    }
    this.apiService.getTeamSavedLists(tus.join(',')).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => this.teamSavedLists.set(data),
      error: () => { /* supplementary view — leave the prior set in place */ }
    });
  }

  selectCustomer(customer: Customer): void {
    this.usageTracking.trackProfileOpened(customer.id.toString());
    const tab = this._detectFocusTab();
    const params: Record<string, string | number> = { customerId: customer.id };
    if (tab) params['tab'] = tab;
    this.router.navigate(['/'], { queryParams: params });
  }

  /** The profile tab a clicked result opens on — see detectFocusTab (utils). */
  private _detectFocusTab(): string | null {
    return detectFocusTab(this.appliedRefinements(), this.queryText(), this.noteFilterActive(),
      q => this.nlqFilterService.queryInvolvesDpContracts(q));
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

  /** Record whether a note's clamped body is actually clipped (from ClampOverflowDirective). */
  setNoteOverflow(noteId: number, overflowing: boolean): void {
    this.overflowingNoteIds.update(s => {
      if (s.has(noteId) === overflowing) return s; // no change → keep reference stable
      const next = new Set(s);
      overflowing ? next.add(noteId) : next.delete(noteId);
      return next;
    });
  }

  /** True when a note's body is genuinely truncated by the clamp (so it needs a "See more"). */
  isNoteOverflowing(noteId: number): boolean {
    return this.overflowingNoteIds().has(noteId);
  }

  /** Whether an individual long note is expanded to its full body. */
  isNoteTextExpanded(noteId: number): boolean {
    return this.expandedNoteTextIds().has(noteId);
  }

  /** Toggle a single long note between clamped and full. */
  toggleNoteText(noteId: number): void {
    this.expandedNoteTextIds.update(s => {
      const next = new Set(s);
      if (next.has(noteId)) next.delete(noteId); else next.add(noteId);
      return next;
    });
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
    return initials(name);
  }

  getFormattedLocation(customer: Customer): string {
    return formattedLocation(customer);
  }

  getLastContactInfo(customerId: number): { text: string; colorClass: string; daysAgo: number } {
    // The badges read only the last-contact aggregate; if that failed to load, "no row" means unknown.
    const unknown = this.appState.noteLastContactsLoadFailed() && this.appState.noteLastContacts().length === 0;
    return this.lastContactByCustomer().get(customerId)
      ?? (unknown
        ? { text: 'Last contact unavailable', colorClass: 'text-gray-400 dark:text-gray-500', daysAgo: Infinity }
        : { text: 'Never contacted', colorClass: 'text-scoular-red', daysAgo: Infinity });
  }

  getCustomerCrops(customerId: number): string[] {
    return this.cropsByCustomer().get(customerId) ?? [];
  }

  /** Per-crop grain on farm with bushels on hand, largest first — see grainOnFarmBreakdown (utils). */
  grainOnFarmBreakdown(customer: Customer): GrainOnFarmItem[] {
    return grainOnFarmBreakdown(customer);
  }

  /** Storage receipts grouped by numeric customerId (StoredGrain joins on Customer.id, not scoularId). */
  private readonly _storageByCustomerId = computed(() => groupByCustomerId(this.storedGrain()));

  /** Total bushels a producer currently has in storage (sum of NET_QUANTITY across all receipts).
   *  Drives the Storage-results sort (most storage first). */
  storageBu(customer: Customer): number {
    return storageTotalBushels(this._storageByCustomerId().get(customer.id) ?? []);
  }

  /** Shared per-crop chip color, exposed to the template. */
  readonly commodityChipClass = commodityChipClass;

  /** Lower-cased commodity code OR name → crop category ("yc"/"corn" → "Corn"), from the
   *  Commodities table — so storage chips (which carry codes like YC/SOR) color by their crop. */
  private readonly _commodityCategoryByKey = computed(() => commodityCategoryByKey(this.appState.commodities()));

  /** Per-commodity storage totals (bushels summed across locations), largest first — mirrors the
   *  grain-on-farm chips so Storage results show each commodity + bushels inline without opening
   *  the producer. `category` is the resolved crop name used for the shared chip color (the raw
   *  `crop` code is still what's displayed). */
  storageBreakdown(customer: Customer): CropBushels[] {
    return storageBreakdown(this._storageByCustomerId().get(customer.id) ?? [], this._commodityCategoryByKey());
  }

  /** DP rows grouped by numeric customerId. Mirror of `_storageByCustomerId`. */
  private readonly _dpByCustomerId = computed(() => groupByCustomerId(this.dpContracts()));

  /** Total bushels a producer has on DP. Drives the DP-results sort (most DP first).
   *  Counted once per delivery — the view repeats the quantity on every charge-type row. */
  dpBu(customer: Customer): number {
    return dpTotalBushels(this._dpByCustomerId().get(customer.id) ?? []);
  }

  /** Per-commodity DP totals, largest first — the inline chips on DP results. Bushels are
   *  per-delivery and charges are summed across charge rows (see dp-aggregate). */
  dpBreakdown(customer: Customer): CropBushels[] {
    const catByKey = this._commodityCategoryByKey();
    return dpBreakdown(this._dpByCustomerId().get(customer.id) ?? [], catByKey);
  }

  /** Planting intentions grouped by numeric customerId. Mirror of `_storageByCustomerId`. */
  private readonly _plantingByCustomerId = computed(() => groupByCustomerId(this.plantingIntentions()));

  /**
   * Season / irrigation type the running prompt asks about ("Producers with 2025 planting
   * intentions"). Refine-panel values win when set — the panel hides its year control for prompts
   * that already name one, so in practice only one of the two is ever in play.
   */
  private readonly _plantingQueryScope = computed(() => plantingQueryScope(this.queryText()));

  /** Per-crop planting chips for a producer — see plantingChips() for the year/type scoping. */
  plantingBreakdown(customer: Customer): PlantingChip[] {
    const r = this.appliedRefinements();
    const q = this._plantingQueryScope();
    return plantingChips(
      this._plantingByCustomerId().get(customer.id) ?? [],
      {
        year: r.plantingYear ?? q.year,
        irrigatedOnly: r.irrigatedOnly || q.irrigatedOnly,
        drylandOnly: r.drylandOnly || q.drylandOnly,
        doubleCropOnly: r.doubleCropOnly,
      },
      this._commodityCategoryByKey(),
    );
  }

  /** Acres across the chips shown for a producer — drives the Planting-results sort. */
  plantingAcres(customer: Customer): number {
    return this.plantingBreakdown(customer).reduce((sum, c) => sum + c.acres, 0);
  }

  /**
   * The dimension-specific chips rendered inline after a result's location — storage bushels,
   * planting acres or grain on farm, whichever the prompt is about. Empty for every other
   * category, in which case the row falls back to the producer's total acres.
   *
   * Numbers are formatted here rather than in the template because each chip is a single string.
   */
  resultChips(customer: Customer): { text: string; colorKey: string; neutral?: boolean }[] {
    if (this.showDpFilters()) {
      return this.dpBreakdown(customer)
        .map(b => ({ text: `${b.crop} ${b.bushels.toLocaleString('en-US')}`, colorKey: b.category }));
    }
    if (this.showStorageFilters()) {
      return this.storageBreakdown(customer)
        .map(b => ({ text: `${b.crop} ${b.bushels.toLocaleString('en-US')}`, colorKey: b.category }));
    }
    if (this.showPlantingFilters()) {
      return this.plantingBreakdown(customer)
        .map(c => ({ text: `${c.label} · ${c.acres.toLocaleString('en-US')} ac · ${c.year}`, colorKey: c.colorKey }));
    }
    if (this.showGrainOnFarmFilters()) {
      // Only how many bin sites the producer has (a neutral chip — it is not a crop). The crops are in the
      // bin-site breakdown next to the name, so no per-crop chips here (user 2026-10-12: too much at once).
      const sites = customer.binSites?.length ?? 0;
      return [{ text: sites > 0 ? `${sites} bin site${sites === 1 ? '' : 's'}` : 'No bin sites', colorKey: '', neutral: true }];
    }
    return [];
  }

  // ── Bin sites & grain (Grain on Farm & Bin Sites prompts, user 2026-10-09) ────────────────────
  // Each result row shows its bin sites and the grain stored at each one in a column right after the
  // name (the same grouping the producer profile uses); the notes column follows it.

  readonly formatLastBid = formatLastBid;

  /** Opens the producer from its name — unless the click ended a text selection (the user was
   *  selecting the name to copy it). */
  openProducerFromName(customer: Customer): void {
    if (window.getSelection()?.toString().trim()) return;
    this.selectCustomer(customer);
  }

  /** Bin sites listed per producer before "Show more". Each is one line until opened, so a few more fit
   *  than when every site showed its grain. */
  readonly binSitesVisible = 4;

  /** "Show 3 more bin sites", or null when every site is listed. */
  binSiteGrainHiddenLabel(groups: BinSiteGrainGroup[]): string | null {
    return binSiteGrainHiddenLabel(groups, this.binSitesVisible);
  }

  /** Open bin sites, as "customerId:index" (index into binSiteGrainBreakdown, which keeps the saved site
   *  order). Every site starts closed — its grain shows only once the user opens it (user 2026-10-12: a
   *  producer with many bins showed too much at once). */
  readonly openBinSites = signal<ReadonlySet<string>>(new Set());

  isBinSiteOpen(customerId: number, index: number): boolean {
    return this.openBinSites().has(`${customerId}:${index}`);
  }

  toggleBinSite(customerId: number, index: number): void {
    const key = `${customerId}:${index}`;
    this.openBinSites.update(open => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  /** Whether any of this producer's sites is open — the crop column headings show only then. */
  anyBinSiteOpen(customerId: number): boolean {
    const prefix = `${customerId}:`;
    for (const key of this.openBinSites()) if (key.startsWith(prefix)) return true;
    return false;
  }

  /** A closed site's line: "2 crops · 35,000 bu", or "No grain on farm". */
  binSiteGrainSummary(group: BinSiteGrainGroup): string {
    return binSiteGrainSummary(group);
  }
  /** Producers whose full list of bin sites is showing. */
  readonly binSitesShowAll = signal<ReadonlySet<number>>(new Set());

  toggleBinSitesShowAll(customerId: number): void {
    this.binSitesShowAll.update(open => {
      const next = new Set(open);
      if (!next.delete(customerId)) next.add(customerId);
      return next;
    });
  }

  hasBinSiteGrain(customer: Customer): boolean {
    return hasBinSiteGrain(customer);
  }

  /** The rows of a producer's breakdown — see binSiteGrainBreakdown in shared/utils/grain-on-farm. */
  binSiteGrainBreakdown(customer: Customer): BinSiteGrainGroup[] {
    return binSiteGrainBreakdown(customer.binSites, customer.grainOnFarm);
  }

  /**
   * Whether the identity column gets the wide, wrapping layout instead of the fixed 18rem one —
   * true for the categories that render inline chips, which need the extra room.
   */
  readonly wideIdentityColumn = computed(() =>
    this.showStorageFilters() || this.showDpFilters() || this.showPlantingFilters() || this.showGrainOnFarmFilters());
}
