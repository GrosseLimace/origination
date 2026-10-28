import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { MsalService } from '@azure/msal-angular';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { NlqFilterService, NlqFilterContext } from '@core/services/nlq-filter.service';
import { UserRolesService } from '@core/services/user-roles.service';
import type { SavedList } from '@models';
import { filterSavedListsByTradeUnitOverlap } from '@shared/utils/saved-list-trade-units';
import { HomeBackgroundFailures } from './home-background-failures';
import { HomePageState } from './home-page.state';

/**
 * Saved lists on the producer page: the user's own lists and (for a manager) the team's lists tied
 * to the selected trade units, each resolved locally into the producers it holds, and the profile
 * header's Add-to-List membership save. Provided by HomeComponent, which exposes these signals and
 * calls in when the data the lists resolve against arrives.
 *
 * A list stores an NLQ query, refinement filters and manual include/exclude overrides; which
 * producers it holds is computed here from the page's loaded data (enrichSavedLists) and cached on
 * the list as customerIds.
 */
@Injectable()
export class HomeSavedListsStore {
  private readonly apiService = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly msalService = inject(MsalService);
  private readonly toastService = inject(ToastService);
  private readonly nlqFilterService = inject(NlqFilterService);
  private readonly backgroundFailures = inject(HomeBackgroundFailures);
  private readonly page = inject(HomePageState);
  private readonly destroyRef = inject(DestroyRef);

  /** Manager = holds the "Admin" app role (same gate as the Usage Dashboard). Enables the
   *  "Team Lists" tab in the Add-to-List dropdown. */
  readonly isManager = inject(UserRolesService).isAdmin;

  /** Guards the one-per-session background full-notes fetch used by saved-list enrichment. */
  private _notesFetchInFlight = false;

  readonly savedLists = signal<SavedList[]>([]);
  /** Manager-only: saved lists tied to the selected TU(s) created by other users (overlap-matched
   *  server-side, enriched locally). Powers the Add-to-List "Team Lists" tab. */
  readonly teamSavedLists = signal<SavedList[]>([]);
  /** Saved lists sharing at least one trade unit with the current selection — the lists a producer
   *  can be quick-added to from the profile header. Reads the enriched savedLists() so the
   *  Add-to-List checkboxes stay reactive after a toggle. */
  readonly savedListsForSelectedCustomer = computed<SavedList[]>(() =>
    filterSavedListsByTradeUnitOverlap(this.savedLists(), this.page.selectedTradeUnits()));
  /** Manager-only team lists the producer can be quick-added to. Already TU-scoped (overlap) by the
   *  server; enriched locally so the checkboxes reflect query-derived membership too. */
  readonly teamListsForSelectedCustomer = computed<SavedList[]>(() =>
    this.page.selectedTradeUnits().length === 0 ? [] : this.teamSavedLists());

  /** Loads the user's own lists (and, once, the query library their categories resolve against),
   *  then resolves them. */
  loadSavedLists(): void {
    this.apiService.getSavedLists().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        const list = data ?? [];
        this.savedLists.set(list);
        this.appState.setSavedLists(list);
        this.appState.setSavedListsLoadFailed(false);
        // Always ensure the query library is in appState so customer-list (which renders the
        // saved list dropdown on this page) can resolve a saved list's prompt category by
        // queryText match. Cached after first fetch — both home and build-list reuse it.
        if (this.appState.queryLibrary().length === 0) {
          this.apiService.getQueryLibrary().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: (items) => {
              this.appState.setQueryLibrary(items);
              // Re-evaluate saved lists with the now-available category fallback.
              this.enrichSavedLists(true);
            },
            error: () => this.enrichSavedLists()
          });
        } else {
          this.enrichSavedLists();
        }
      },
      error: (err) => {
        this.appState.setSavedListsLoadFailed(true);
        this.backgroundFailures.report('load saved lists', err);
      }
    });
  }

  /** Resolves each list that needs it (or every list, with forceRefresh) against the page's data. */
  enrichSavedLists(forceRefresh = false): void {
    if (!this.page.customers().length) return;
    // Own lists: skip if all already have cached customerIds — unless forceRefresh (e.g. when
    // contracts/tickets/stored grain arrive after initial enrichment).
    const ownNeeds = forceRefresh || this.savedLists().some(l => !l.customerIds?.length);
    if (this.savedLists().length && ownNeeds) {
      this.savedLists.set(this._enrichLists(this.savedLists(), forceRefresh));
    }
    // Team lists (manager) follow the same enrichment so their checkboxes reflect query membership.
    const teamNeeds = forceRefresh || this.teamSavedLists().some(l => !l.customerIds?.length);
    if (this.teamSavedLists().length && teamNeeds) {
      this.teamSavedLists.set(this._enrichLists(this.teamSavedLists(), forceRefresh));
    }
    // The full note set (bodies/authors) is only needed for saved lists whose query or refine
    // filters actually read note CONTENT/authors/pinned/counts — recency lists ("not contacted…")
    // and every non-note list resolve from the last-contact aggregate. Only kick off the
    // background full-notes fetch when at least one UNRESOLVED list genuinely needs it, so a user
    // whose lists are all contracts/tickets/etc. never pays the notes download on home load.
    const listNeedsFullNotes = (l: SavedList) =>
      (forceRefresh || !l.customerIds?.length)
      && (this.nlqFilterService.queryNeedsFullNotes(l.query)
          || this.nlqFilterService.refineFiltersNeedFullNotes(l.filters));
    const anyNeedsFullNotes =
      this.savedLists().some(listNeedsFullNotes) || this.teamSavedLists().some(listNeedsFullNotes);
    if (anyNeedsFullNotes && !this.appState.notesLoaded()) {
      this._loadFullNotesForEnrichment();
    }
  }

  /** Background one-shot fetch of the full note set for saved-list NLQ enrichment. */
  private _loadFullNotesForEnrichment(): void {
    if (this._notesFetchInFlight || this.appState.notesLoaded()) return;
    this._notesFetchInFlight = true;
    this.apiService.getNotes().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this._notesFetchInFlight = false;
        this.appState.setNotes(data ?? []);
        // Re-evaluate saved lists now that note-based queries have their data.
        this.enrichSavedLists(true);
      },
      error: () => { this._notesFetchInFlight = false; }
    });
  }

  /** Resolve each list's NLQ query + filters + included/excluded overrides into a cached
   *  `customerIds` array, using the page's currently-loaded data. Returns a new array. */
  private _enrichLists(lists: SavedList[], forceRefresh: boolean): SavedList[] {
    if (!lists.length || !this.page.customers().length) return lists;
    const account = this.msalService.instance.getActiveAccount()
      ?? this.msalService.instance.getAllAccounts()[0];
    const context: NlqFilterContext = {
      customers: this.page.customers(),
      contracts: this.page.contracts(),
      tickets: this.page.tickets(),
      // Full note set from the lazy NLQ cache — empty until a note-based list triggers
      // _loadFullNotesForEnrichment, which re-enriches once it lands.
      notes: this.appState.notes(),
      // Last-contact aggregate (always loaded) — powers recency/"never contacted" resolution
      // without the full note set.
      noteLastContacts: this.appState.noteLastContacts(),
      myReminders: this.appState.myReminders(),
      plantingIntentions: this.page.plantingIntentions(),
      storedGrain: this.page.storedGrain(),
      dpContracts: this.page.dpContracts(),
      commodities: this.appState.commodities(),
      commodityConversions: this.appState.commodityConversions(),
      // Thread identity through so saved-list "by me" filters work even when notes' CreatedBy
      // wasn't resolved to a display name on the API side.
      currentUserDisplayName: account?.name ?? '',
      currentUserUsername: account?.username ?? ''
    };
    const queryLibrary = this.appState.queryLibrary();
    return lists.map(list => {
      if (!forceRefresh && list.customerIds?.length) return list; // Already resolved
      // Resolve "I"/"me"/"my" to the user's name so author-based queries work
      const resolvedQuery = this.nlqFilterService.resolveUserReferences(list.query, account?.name ?? '', account?.username ?? '');
      const result = this.nlqFilterService.parseAndFilter(resolvedQuery, context);
      // If no patterns matched, the NLQ returned all customers — don't cache that as valid
      if (result.matchedPatterns.length === 0) return list;
      // Backfill _promptCategory if the saved list pre-dates the hint AND the query library
      // has a match for its queryText. Lets the dimension-aware crops filter in the service
      // still find the right category for older saved lists without requiring a re-save.
      let listFilters = list.filters;
      if (listFilters && !listFilters._promptCategory && queryLibrary.length > 0) {
        const qLower = list.query.trim().toLowerCase();
        const matched = queryLibrary.find(q => q.queryText.trim().toLowerCase() === qLower);
        if (matched?.category) listFilters = { ...listFilters, _promptCategory: matched.category };
      }
      const refined = listFilters
        ? this.nlqFilterService.applyRefinementFilters(result.customers, listFilters, this.page.contracts(), this.appState.notes(), {
            tickets: this.page.tickets(),
            storedGrain: this.page.storedGrain(),
            dpContracts: this.page.dpContracts(),
            plantingIntentions: this.page.plantingIntentions(),
            commodityConversions: this.appState.commodityConversions(),
            noteLastContacts: this.appState.noteLastContacts(),
            commodities: this.appState.commodities()
          })
        : result.customers;
      const ids = this.nlqFilterService.applyCustomerOverrides(
        refined.map(c => c.id), list.includedCustomerIds, list.excludedCustomerIds
      );
      return { ...list, customerIds: ids };
    });
  }

  /** Manager-only: fetch the team lists tied to the selected TU(s) and enrich them. Clears the set
   *  for non-managers or when no TU is selected. */
  loadTeamLists(): void {
    const tus = this.page.selectedTradeUnits();
    if (!this.isManager() || tus.length === 0) {
      this.teamSavedLists.set([]);
      return;
    }
    this.apiService.getTeamSavedLists(tus.join(',')).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => this.teamSavedLists.set(this._enrichLists(data ?? [], true)),
      error: () => { /* supplementary view — leave the prior set in place */ }
    });
  }

  /**
   * Apply staged saved-list membership changes for the selected producer (from the profile
   * header's Save). Membership lives in each list's included/excluded arrays; we mutate those
   * (build-list rules), optimistically update + re-enrich locally, then persist each changed list
   * via a full PUT (updateSavedList blanks omitted fields, so every field is sent). One success
   * notification when all succeed; reverts everything on any error.
   */
  saveMembership(changes: { listId: number; add: boolean }[]): void {
    const customer = this.page.selectedCustomer();
    if (!customer || changes.length === 0) return;
    const cid = customer.id;
    // A change may target the user's own list OR (for a manager) a team list — snapshot both for
    // revert and resolve each change against whichever set owns the id.
    const ownOriginals = this.savedLists();
    const teamOriginals = this.teamSavedLists();
    const ownWorking = [...ownOriginals];
    const teamWorking = [...teamOriginals];
    let ownChanged = false;
    let teamChanged = false;
    const updates$ = [];

    for (const ch of changes) {
      let working = ownWorking;
      let idx = ownWorking.findIndex(l => l.id === ch.listId);
      let isTeam = false;
      if (idx === -1) {
        idx = teamWorking.findIndex(l => l.id === ch.listId);
        working = teamWorking;
        isTeam = true;
      }
      if (idx === -1) continue;
      const list = working[idx];
      const included = new Set(list.includedCustomerIds ?? []);
      const excluded = new Set(list.excludedCustomerIds ?? []);
      if (ch.add) {
        excluded.delete(cid);
        included.add(cid);
      } else {
        // Mirror build-list: drop a manual add if present, else exclude a query-matched member.
        if (included.has(cid)) included.delete(cid);
        else excluded.add(cid);
      }
      const newIncluded = [...included];
      const newExcluded = [...excluded];
      // Drop cached customerIds so enrichSavedLists rebuilds this list's membership.
      working[idx] = { ...list, includedCustomerIds: newIncluded, excludedCustomerIds: newExcluded, customerIds: undefined };
      if (isTeam) teamChanged = true; else ownChanged = true;
      updates$.push(this.apiService.updateSavedList(list.id, {
        name: list.name,
        query: list.query,
        tradeUnits: list.tradeUnits,
        filters: list.filters,
        includedCustomerIds: newIncluded,
        excludedCustomerIds: newExcluded,
      }));
    }
    if (updates$.length === 0) return;

    // Optimistic local apply, then persist all changed lists together.
    if (ownChanged) { this.savedLists.set(ownWorking); this.appState.setSavedLists(ownWorking); }
    if (teamChanged) { this.teamSavedLists.set(teamWorking); }
    this.enrichSavedLists(true);

    forkJoin(updates$).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.toastService.success(
        updates$.length === 1 ? 'Saved list updated' : `${updates$.length} saved lists updated`
      ),
      error: () => {
        if (ownChanged) { this.savedLists.set(ownOriginals); this.appState.setSavedLists(ownOriginals); }
        if (teamChanged) { this.teamSavedLists.set(teamOriginals); }
        this.enrichSavedLists(true);
        this.toastService.error('Failed to save list changes');
      }
    });
  }
}
