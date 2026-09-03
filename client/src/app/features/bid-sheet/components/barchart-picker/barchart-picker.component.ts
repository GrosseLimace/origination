import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import {
  BarchartCatalogLocation,
  BarchartCoverage
} from '@models';

/** Map centre + radius the picker searches around, supplied by the bid sheet map. */
export interface BarchartSearchArea {
  latitude: number;
  longitude: number;
  radiusMiles: number;
}

/** Several locations added in one go from the list's checkboxes. */
export interface BarchartBulkAddRequest {
  locations: Array<{
    locationKey: string;
    name: string;
    isScoularFacility: boolean;
    /** The bid-sheet location id if this listing is already a company-wide row (from its
     *  placements); present means "link it to the sheet", absent means "create it first". */
    existingLocationId?: number;
  }>;
}

/**
 * "Add from BarChart" picker.
 *
 * Discovery is map-first on purpose. With text-only search a user who finds nothing can't tell
 * whether BarChart doesn't list the location, lists it under another company name, or we simply
 * don't pull that state — and they'd reasonably conclude the feed is broken. So the default view
 * follows the map the originator is already looking at, text search is the secondary path, and the
 * catalog's actual coverage is stated rather than left to be inferred from an empty list.
 */
@Component({
  selector: 'app-barchart-picker',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet],
  
  templateUrl: './barchart-picker.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarchartPickerComponent {
  /** Map centre to search around. Changes as the user pans, which re-runs the nearby search. */
  readonly searchArea = input<BarchartSearchArea | null>(null);

  /** Name of the sheet ticked locations will be added to, shown in the footer. */
  readonly sheetName = input<string>('');

  /** Location ids already on the active sheet, so an already-added listing can't be ticked again. */
  readonly sheetLocationIds = input<ReadonlySet<number>>(new Set());

  /**
   * True while the parent is creating the ticked locations and preparing Edit Bids. Each create
   * runs the feed bridge server-side, so a big batch takes visible seconds -- without a busy state
   * the button reads as frozen and gets clicked again.
   */
  readonly adding = input(false);

  /** Results, so the parent can draw them as pins on the map. */
  readonly resultsChange = output<BarchartCatalogLocation[]>();

  /** A location the user picked in the list — the parent flies the map to it. */
  readonly focus = output<BarchartCatalogLocation>();

  /** Several locations at once, from the list checkboxes. */
  readonly addMany = output<BarchartBulkAddRequest>();

  /** Ticked keys, so the map can colour their pins to match the list. */
  readonly selectionChange = output<ReadonlySet<string>>();

  readonly close = output<void>();

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchText = signal('');
  readonly stateFilter = signal('');
  readonly results = signal<BarchartCatalogLocation[]>([]);
  readonly loading = signal(false);
  readonly coverage = signal<BarchartCoverage | null>(null);

  /**
   * Locations ticked in the list. Adding one at a time meant a name-and-confirm round trip per
   * elevator, which is painful when an originator is standing up a whole area at once. They tick
   * what they want, add the lot, and rename or reclassify afterwards on the Edit Bids screen.
   */
  /**
   * Holds the whole location, not just its key.
   *
   * Ticking is a running basket across searches: pick a few near one town, pan somewhere else, pick
   * a few more, add the lot. Keeping keys alone meant rebuilding the request from the CURRENT results,
   * so anything ticked before the last search had quietly vanished from it -- the footer still counted
   * them and the add silently dropped them.
   */
  readonly selected = signal<ReadonlyMap<string, BarchartCatalogLocation>>(new Map());

  readonly selectedCount = computed(() => this.selected().size);

  /** Keys only, for the parent's pin colouring. */
  readonly selectedKeys = computed<ReadonlySet<string>>(() => new Set(this.selected().keys()));

  /**
   * Ticked locations that the current search is not showing.
   *
   * Rendered under the results rather than dropped, because building a batch means moving the map
   * about: without them the earlier picks disappear from the panel while the footer goes on counting
   * them, so the user cannot check the batch before committing to it.
   */
  readonly offListSelected = computed(() => {
    const shown = new Set(this.results().map(r => r.locationKey));
    return [...this.selected().values()].filter(l => !shown.has(l.locationKey));
  });

  isSelected(locationKey: string): boolean {
    return this.selected().has(locationKey);
  }

  toggleSelected(location: BarchartCatalogLocation, event?: Event): void {
    // Stops the row handler running as well, which would tick it straight back off.
    event?.stopPropagation();
    if (this.adding()) return; // the batch is already on its way to the server
    if (this.alreadyOnSheet(location)) return; // nothing left to add it to
    this.selected.update(current => {
      const next = new Map(current);
      next.has(location.locationKey) ? next.delete(location.locationKey) : next.set(location.locationKey, location);
      return next;
    });
    this.selectionChange.emit(this.selectedKeys());
  }

  clearSelection(): void {
    this.selected.set(new Map());
    this.selectionChange.emit(this.selectedKeys());
  }

  /**
   * Whether a listing is one of ours. BarChart carries Scoular sites like anyone else's -- 26 of them
   * across six naming variants (Scoular Company - Nebraska, The Scoular Company, Scoular Co - West) --
   * and the publishing company is the reliable field: some site names carry the word and some, like
   * "Corley, IA", do not. Checked against the live catalog, the name match has no false positives.
   * The user can still correct it on the Edit Bids screen.
   */
  isScoularListing(location: BarchartCatalogLocation): boolean {
    return (location.elevator ?? '').toLowerCase().includes('scoular');
  }

  /**
   * The bid-sheet location id this listing already exists as, company-wide -- or null if it has
   * never been added by anyone. A listing's placements array holds at most one entry now that
   * locations are de-duplicated to one row per elevator, so this is a lookup, not a filter.
   */
  existingLocationId(location: BarchartCatalogLocation): number | null {
    return location.placements[0]?.locationId ?? null;
  }

  /** Already on the ACTIVE sheet -- ticking it again can only be a no-op, so the checkbox is off.
   *  Existing elsewhere company-wide but not on this sheet is still selectable: ticking it just
   *  links the existing row instead of creating a new one. */
  alreadyOnSheet(location: BarchartCatalogLocation): boolean {
    const id = this.existingLocationId(location);
    return id != null && this.sheetLocationIds().has(id);
  }

  /** Emits every ticked location, named as the vendor names it and pre-classified. */
  addSelected(): void {
    if (this.adding()) return;
    const picked = [...this.selected().values()];
    if (picked.length === 0) return;

    this.addMany.emit({
      locations: picked.map(l => ({
        locationKey: l.locationKey,
        name: this.defaultName(l),
        isScoularFacility: this.isScoularListing(l),
        existingLocationId: this.existingLocationId(l) ?? undefined
      }))
    });
  }

  private _searchDebounce: ReturnType<typeof setTimeout> | null = null;

  /** A typed search or a state filter searches the whole catalog; otherwise we follow the map. */
  readonly isTextSearch = computed(() => this.searchText().trim().length > 0 || !!this.stateFilter());

  /** States sorted by coverage, for the filter dropdown. */
  readonly coverageStates = computed(() => this.coverage()?.states ?? []);

  /** " (IA, IL, KS…)" for the empty-result message — names the coverage we actually hold. */
  readonly topStatesLabel = computed(() => {
    const states = this.coverageStates();
    if (states.length === 0) return '';
    const names = states.slice(0, 6).map(s => s.state).join(', ');
    return ' (' + names + (states.length > 6 ? '…' : '') + ')';
  });

  readonly coverageSummary = computed(() => {
    const c = this.coverage();
    if (!c) return '';
    const refreshed = c.lastRefreshedUtc
      ? ` · refreshed ${new Date(c.lastRefreshedUtc).toLocaleDateString()}`
      : '';
    return `${c.locationCount.toLocaleString()} locations across ${c.states.length} states${refreshed}`;
  });

  constructor() {
    this.api.getBarchartCoverage().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: c => this.coverage.set(c),
      // A missing coverage line is cosmetic; the picker still works, so don't interrupt the user.
      error: () => this.coverage.set(null),
    });

    // Re-run the nearby search when the map moves, unless the user has typed — a text search is
    // catalog-wide and shouldn't be silently narrowed by wherever the map happens to sit.
    //
    // Reads searchArea ONLY. It used to read isTextSearch() too, which made emptying the search box
    // or picking "All states" fire this effect AND the caller's own search: two identical requests
    // whose responses could land out of order. The text paths now own their own searching.
    effect(() => {
      const area = this.searchArea();
      if (!area) return;
      if (this.isTextSearchUntracked()) return;
      this._runSearch();
    });

    // The panel is destroyed abruptly when the user leaves BarChart mode, so a debounce still in
    // flight would call into a torn-down component.
    this.destroyRef.onDestroy(() => {
      if (this._searchDebounce) clearTimeout(this._searchDebounce);
    });
  }

  /** isTextSearch without registering a dependency — see the effect above. */
  private isTextSearchUntracked(): boolean {
    return untracked(() => this.isTextSearch());
  }

  onSearchInput(value: string): void {
    this.searchText.set(value);
    if (this._searchDebounce) clearTimeout(this._searchDebounce);
    this._searchDebounce = setTimeout(() => this._runSearch(), 300);
  }

  onStateChange(value: string): void {
    this.stateFilter.set(value);
    this._runSearch();
  }

  clearSearch(): void {
    if (this._searchDebounce) clearTimeout(this._searchDebounce); // a pending keystroke search is moot now
    this.searchText.set('');
    this.stateFilter.set('');
    this._runSearch();
  }

  private _runSearch(): void {
    const area = this.searchArea();
    const text = this.searchText().trim();
    const state = this.stateFilter();

    this.loading.set(true);
    this.api.searchBarchartLocations({
      search: text || undefined,
      state: state || undefined,
      // Geography applies only when the user hasn't narrowed by name or state; mixing both would
      // hide the match they typed just because it sits outside the current view.
      latitude: text || state ? undefined : area?.latitude,
      longitude: text || state ? undefined : area?.longitude,
      radiusMiles: text || state ? undefined : area?.radiusMiles,
      take: 50,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: rows => {
        this.loading.set(false);
        this.results.set(rows);
        this.resultsChange.emit(rows);
      },
      error: () => {
        this.loading.set(false);
        this.results.set([]);
        this.resultsChange.emit([]);
        this.toast.error('Could not load BarChart locations');
      },
    });
  }

  /** Row click ticks the location and pans the map to it, so the pin and the row agree. */
  selectLocation(location: BarchartCatalogLocation): void {
    this.focus.emit(location);
    this.toggleSelected(location);
  }

  /**
   * The name proposed for the bid sheet — "Farmers Cooperative Dorchester - Beattie".
   *
   * Same as the displayed label, except this always carries a site or town. On screen the town sits on
   * the line below the label; a bid sheet row has no second line, and names must be unique per trade
   * unit, so a company with several town-named sites would otherwise want the same row name for all of
   * them. The user does not see this before the add -- the confirm step that used to show it was
   * dropped in favour of ticking a batch -- so Edit Bids opens straight afterwards with the new rows
   * renameable in place. That is where a vendor name gets corrected.
   */
  defaultName(location: BarchartCatalogLocation): string {
    const company = location.elevator?.trim();
    const site = this.siteLabel(location) || location.city?.trim() || '';
    if (company && site) return `${company} - ${site}`;
    return company || site || `BarChart ${location.locationKey}`;
  }

  /**
   * The part that distinguishes one of a company's locations from another — or empty when the vendor's
   * site name is just the town again and would only repeat the line beneath it.
   *
   * Measured on the live catalog (2026-08-19, 3,446 listings): 1,775 set the site name to the city and
   * another 304 set it to the city plus the state ("Salina, KS", "FARNSWORTH TX") — 60% of the catalog
   * between them, and that share has held steady as the catalog grew. Comparison is on letters and
   * digits only, so all those spellings collapse the same way.
   */
  siteLabel(location: BarchartCatalogLocation): string {
    const site = location.locationName?.trim() ?? '';
    if (!site) return '';

    const key = this._nameKey(site);
    const city = this._nameKey(location.city);
    if (city && (key === city || key === city + this._nameKey(location.state))) return '';

    return site;
  }

  /** Letters and digits only, upper-cased — so "Salina, KS", "SALINA KS" and "salinaks" all match. */
  private _nameKey(value: string | undefined): string {
    return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /**
   * Headline for a listing: the company, then which of its sites —
   * "Farmers Cooperative Dorchester - Beattie". This is also what gets saved, so what a user picks in
   * the list is what lands on their sheet.
   *
   * Company leads deliberately. The vendor's site name alone is a poor label: half of them are just the
   * town, which is ambiguous on a bid sheet and can collide with the unique name-per-trade-unit rule,
   * and some name a different company than the one publishing the bid (a CHS listing whose site name is
   * "GPC Muscatine") — leading with that would misattribute the price at a glance.
   */
  primaryName(location: BarchartCatalogLocation): string {
    const company = location.elevator?.trim();
    const site = this.siteLabel(location);
    if (company && site) return `${company} - ${site}`;
    return company || site || `BarChart ${location.locationKey}`;
  }

  /** Under the headline: just where it is. The site name is already part of the headline. */
  locationSubtitle(location: BarchartCatalogLocation): string {
    return [location.city, location.state].filter(Boolean).join(', ');
  }
}
