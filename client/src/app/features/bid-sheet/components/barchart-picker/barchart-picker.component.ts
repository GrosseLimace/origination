import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import {
  BarchartCatalogLocation,
  BarchartCatalogLocationDetail,
  BarchartCoverage
} from '@models';

/** Map centre + radius the picker searches around, supplied by the bid sheet map. */
export interface BarchartSearchArea {
  latitude: number;
  longitude: number;
  radiusMiles: number;
}

/** What the parent needs in order to create the bid sheet placements. */
export interface BarchartAddRequest {
  locationKey: string;
  /** Display name to save. Defaults to the vendor's site name but the user can change it. */
  name: string;
  tradeUnitCodes: string[];
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
  imports: [FormsModule],
  templateUrl: './barchart-picker.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarchartPickerComponent {
  /** Map centre to search around. Changes as the user pans, which re-runs the nearby search. */
  readonly searchArea = input<BarchartSearchArea | null>(null);

  /** Trade units the user may add a location to. */
  readonly tradeUnits = input<string[]>([]);

  /**
   * Trade-unit code → description ("2190" → "Pratt, KS"). Used for display and search, so a user can
   * find a desk by where it is rather than having to remember its number.
   */
  readonly tradeUnitLabels = input<Map<string, string>>(new Map());

  /** Location key the parent wants shown as selected (e.g. the user clicked its map pin). */
  readonly selectedKey = input<string | null>(null);

  /** Results, so the parent can draw them as pins on the map. */
  readonly resultsChange = output<BarchartCatalogLocation[]>();

  /** A location the user picked in the list — the parent flies the map to it. */
  readonly focus = output<BarchartCatalogLocation>();

  /** The user confirmed an add. */
  readonly add = output<BarchartAddRequest>();

  readonly close = output<void>();

  /**
   * The confirm step was dismissed. The parent clears its selected key on this, so clicking the same
   * pin again re-opens it — without this the key never changes and the effect below wouldn't re-fire.
   */
  readonly detailClosed = output<void>();

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchText = signal('');
  readonly stateFilter = signal('');
  readonly results = signal<BarchartCatalogLocation[]>([]);
  readonly loading = signal(false);
  readonly coverage = signal<BarchartCoverage | null>(null);

  readonly detail = signal<BarchartCatalogLocationDetail | null>(null);
  readonly detailLoading = signal(false);

  /** Trade units ticked in the confirm step. */
  readonly chosenTus = signal<Set<string>>(new Set());
  readonly nameOverride = signal('');
  readonly saving = signal(false);

  /** Trade-unit selector state. Originators can hold a lot of desks, so it searches rather than scrolls. */
  readonly tuPickerOpen = signal(false);
  readonly tuSearch = signal('');

  /** Trade units matching the search, already-added ones included but flagged. */
  readonly filteredTradeUnits = computed(() => {
    const term = this.tuSearch().trim().toLowerCase();
    const labels = this.tradeUnitLabels();
    return this.tradeUnits().filter(tu => {
      if (!term) return true;
      const label = labels.get(tu)?.toLowerCase() ?? '';
      return tu.toLowerCase().includes(term) || label.includes(term);
    });
  });

  /** What the closed selector says. */
  readonly tuSummary = computed(() => {
    const chosen = [...this.chosenTus()];
    if (chosen.length === 0) return 'Select trade units';
    if (chosen.length === 1) return this.tradeUnitDisplay(chosen[0]);
    return `${chosen.length} trade units`;
  });

  private _searchDebounce: ReturnType<typeof setTimeout> | null = null;

  /** A typed search or a state filter searches the whole catalog; otherwise we follow the map. */
  readonly isTextSearch = computed(() => this.searchText().trim().length > 0 || !!this.stateFilter());

  readonly canAdd = computed(() => this.chosenTus().size > 0 && !!this.detail() && !this.saving());

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
    effect(() => {
      const area = this.searchArea();
      if (this.isTextSearch() || !area) return;
      this._runSearch();
    });

    // The parent tells us which pin was clicked; load that location's preview.
    effect(() => {
      const key = this.selectedKey();
      if (key) this.openDetail(key);
    });
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
    this.searchText.set('');
    this.stateFilter.set('');
    // With a map area set, clearing makes isTextSearch() false and the effect re-runs the nearby
    // search on its own; searching here too would fire the same request twice.
    if (!this.searchArea()) this._runSearch();
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

  selectLocation(location: BarchartCatalogLocation): void {
    this.focus.emit(location);
    this.openDetail(location.locationKey);
  }

  openDetail(locationKey: string): void {
    if (this.detail()?.location.locationKey === locationKey) return;
    this.detailLoading.set(true);
    this.detail.set(null);
    this.api.getBarchartLocation(locationKey).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: d => {
        this.detailLoading.set(false);
        this.detail.set(d);
        this.nameOverride.set(this.defaultName(d.location));
        // Pre-tick the trade units this location isn't already on, but only when there's exactly one
        // choice; with several, making the user pick avoids a location quietly landing on the wrong desk.
        const already = new Set(d.location.placements.map(p => p.tradeUnitCode));
        const open = this.tradeUnits().filter(t => !already.has(t));
        this.chosenTus.set(open.length === 1 ? new Set(open) : new Set());
      },
      error: () => {
        this.detailLoading.set(false);
        this.toast.error('Could not load that location');
      },
    });
  }

  closeDetail(): void {
    this.detail.set(null);
    this.chosenTus.set(new Set());
    this.detailClosed.emit();
  }

  /**
   * Company first, then whichever of the site name or town identifies which of its locations this is —
   * e.g. "Farmers Cooperative Dorchester - Beattie".
   *
   * Deliberately not the vendor's site name alone, which is what the bid sheet used to get. Half of
   * those are just the town ("NORTON"), which is ambiguous on a sheet and can collide with the unique
   * name-per-trade-unit rule; and some name a different company than the one publishing the bid (a
   * CHS listing whose site name is "GPC Muscatine"), which would misattribute the price at a glance.
   */
  defaultName(location: BarchartCatalogLocation): string {
    return this.primaryName(location);
  }

  /**
   * The part that distinguishes one of a company's locations from another: its site name, or the town
   * when the vendor just repeated the town as the site name.
   */
  siteLabel(location: BarchartCatalogLocation): string {
    const site = location.locationName?.trim() ?? '';
    const city = location.city?.trim() ?? '';
    if (!site) return city;
    if (city && site.toUpperCase() === city.toUpperCase()) return city;
    return site;
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

  toggleTu(tu: string): void {
    if (this.alreadyOn(tu)) return; // adding a second placement to the same desk would duplicate its bids
    this.chosenTus.update(set => {
      const next = new Set(set);
      next.has(tu) ? next.delete(tu) : next.add(tu);
      return next;
    });
  }

  /** "2190 · Pratt, KS" when we know the description, else just the code. */
  tradeUnitDisplay(tu: string): string {
    const label = this.tradeUnitLabels().get(tu);
    return label ? `${tu} · ${label}` : tu;
  }

  toggleTuPicker(): void {
    this.tuPickerOpen.update(open => !open);
    if (!this.tuPickerOpen()) this.tuSearch.set('');
  }

  clearChosenTus(): void {
    this.chosenTus.set(new Set());
  }

  /** True when this location is already on that trade unit — the checkbox is then disabled. */
  alreadyOn(tu: string): boolean {
    return (this.detail()?.location.placements ?? []).some(p => p.tradeUnitCode === tu);
  }

  confirmAdd(): void {
    const d = this.detail();
    if (!d || this.chosenTus().size === 0) return;
    this.saving.set(true);
    this.add.emit({
      locationKey: d.location.locationKey,
      name: this.nameOverride().trim() || this.defaultName(d.location),
      tradeUnitCodes: [...this.chosenTus()],
    });
  }

  /** Called by the parent once the add finished, so the button un-sticks either way. */
  addFinished(succeeded: boolean): void {
    this.saving.set(false);
    if (succeeded) this.closeDetail();
  }

  /** "Jan 2027" for a preview row. */
  monthLabel(cropYear: number, month: number): string {
    const names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[month] ?? month} ${cropYear}`;
  }

  formatAsOf(iso: string | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /** Under the headline: just where it is. The site name is already part of the headline. */
  locationSubtitle(location: BarchartCatalogLocation): string {
    return [location.city, location.state].filter(Boolean).join(', ');
  }
}
