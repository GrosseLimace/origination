import { Component, input, output, effect, inject, signal, computed, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent } from '@shared/components/dialog/dialog.component';
import { Customer, Contract, Ticket, Commodity } from '@models';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { formatPhoneProgressive } from '@shared/utils/phone';
import { BIN_SITE_NAME_MAX_LENGTH, COORDINATE_EXAMPLE, MAX_BIN_SITES, MAX_BIN_SITE_CAPACITY, formatBinSiteCapacityInput, formatCoordinatePairFull, parseBinSiteCapacity, parseCoordinatePair } from '@shared/utils/coordinates';
import { scopeCommodities } from '@shared/utils/commodity-scope';
import { buildGrainOnFarmOptions, indexCommoditiesByCode, isLegacyGrainGroup, grainOnFarmTitle } from '@shared/utils/grain-on-farm';
import { buildCropGroupLookup } from '@shared/utils/crop-group-match';
import { AppStateService } from '@core/services/app-state.service';

/** One bin-site row as edited: every field is the text in its input. Bushel fields hold the grouped
 *  display text ("50,000"); commodityCode is '' when none is picked. */
export interface BinSiteEditRow {
  name: string;
  coords: string;
  capacity: string;
  marketed: string;
  unmarketed: string;
  commodityCode: string;
}

const emptyBinSiteRow = (): BinSiteEditRow =>
  ({ name: '', coords: '', capacity: '', marketed: '', unmarketed: '', commodityCode: '' });

/** True when anything other than the coordinates has been filled in. */
const binSiteRowHasData = (r: BinSiteEditRow): boolean =>
  !!(r.name.trim() || r.capacity.trim() || r.marketed.trim() || r.unmarketed.trim() || r.commodityCode.trim());

const BIN_SITE_BUSHEL_LABELS = { capacity: 'Capacity', marketed: 'Marketed', unmarketed: 'Unmarketed' } as const;

@Component({
  selector: 'app-edit-customer-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogComponent,
    DialogHeaderComponent,
    DialogTitleComponent,
    DialogDescriptionComponent,
    DialogContentComponent,
    DialogFooterComponent
  ],
  templateUrl: './edit-customer-dialog.component.html'
})
export class EditCustomerDialogComponent {
  private readonly apiService = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly appState = inject(AppStateService);

  public isOpen = input(false);
  public customer = input<Customer | null>(null);
  public tickets = input<Ticket[]>([]);
  public contracts = input<Contract[]>([]);
  public allCustomers = input<Customer[]>([]);
  public linkedCustomers = input<Customer[]>([]);
  public selectedTradeUnits = input<string[]>([]);

  public close = output<void>();
  public save = output<{
    customerId: number;
    acres: number;
    binCapacity: number;
    commodities: string[];
    // Derived from the primary contact row — kept on the payload so downstream consumers
    // (optimistic updates, linked-producer propagation) don't need to re-derive it.
    primaryContact: string;
    primaryPhone: string;
    contacts: { name: string; phone?: string; email?: string; isPrimary: boolean }[];
    // Parsed at full precision (never rounded); array order is the display order. Capacity in bushels.
    binSites: { name: string; latitude?: number; longitude?: number; capacity?: number; commodityCode?: string; marketed?: number; unmarketed?: number }[];
    linkedProducerIds: string[];
    removedIncomingIds: string[];
    eSignEnabled: boolean;
    tradeUnitCodes: string[];        // Desired ACTIVE manual TU set — reconciled on "Save Changes".
    reconcileTradeUnits: boolean;    // Only reconcile when it's safe + meaningful (see canReconcileTradeUnits).
    grainOnFarm: { commodityCode: string; bushelsOnHand?: number; targetBushels?: number; grade?: string }[];
    // Planting intentions to re-home because their trade unit is being removed. The PARENT runs
    // these, because it owns the cached intention lists that the profile renders — doing it here
    // would move the rows server-side while the table kept showing the old trade unit.
    intentionMoves: { from: string; to: string }[];
  }>();

  // ── Trade-unit assignment / management ──────────────────────────────────
  allTradeUnits = signal<{ code: string; description?: string }[]>([]);
  selectedTuCodes = signal<string[]>([]);      // editable (manual) TU codes
  tuSearch = signal('');
  isLoadingTradeUnits = signal(false);

  // The producer's memberships, loaded on open. Includes active ones (sync-sourced shown locked;
  // manual ones prefill selectedTuCodes) AND previously-removed ones (isActive=false), which feed
  // the re-addable suggestions in the add-search. tuListLoaded gates reconciliation so a failed
  // load can never wipe manual assignments by reconciling to an empty set.
  currentTradeUnits = signal<{ tradeUnit: string; isManual: boolean; hasOpenActivity: boolean; isActive: boolean }[]>([]);
  tuListLoaded = signal(false);
  // Membership-fetch state (distinct from isLoadingTradeUnits, which tracks the add-search catalog).
  // Surfaces a transient load failure as an explicit Error+Retry instead of a silent blank that
  // reads as "no trade units".
  isLoadingCurrentTradeUnits = signal(false);
  currentTradeUnitsError = signal<string | null>(null);
  private _originalManualTuCodes: string[] = [];

  // Locked TUs the user removed this session because the producer is dormant in them. Staged
  // here and committed on "Save Changes" (consistent with the manual reconcile-on-save flow), so
  // a user can back out by cancelling. Each becomes a DELETE .../trade-units/{code} call in onSave.
  removedDormantTuCodes = signal<string[]>([]);

  // ── Planting intentions recorded against a trade unit being removed ──────
  // Removing a trade unit doesn't unplant the acres, so the originator is asked where the rows
  // should count instead rather than leaving them stranded on a trade unit the producer has left
  // (such a row counts on no single-trade-unit dashboard). Loaded lazily on the first removal —
  // removals are rare, so most opens of this dialog never pay for the fetch.
  private _plantingByTu = signal<Map<string, { count: number; acres: number; years: number[] }>>(new Map());
  private _plantingLoaded = false;
  isCheckingPlantingIntentions = signal(false);

  /** The open "where should these acres go?" prompt, or null. */
  tuRemovalPrompt = signal<{
    code: string;
    kind: 'manual' | 'dormant';
    count: number;
    acres: number;
    years: number[];
    targets: string[];
  } | null>(null);
  /** Chosen destination in the prompt; '' means "leave them where they are". */
  tuRemovalTarget = signal<string>('');

  /** from → to, staged until Save, then one retag call each. */
  private _stagedIntentionMoves = signal<Map<string, string>>(new Map());

  /** Active sync-sourced (locked) memberships — used to keep them out of the add-search dropdown
   *  (they're already active memberships). Inactive rows are excluded so a removed TU can be re-added. */
  readonly lockedTradeUnits = computed(() =>
    this.currentTradeUnits().filter(t => !t.isManual && t.isActive).map(t => t.tradeUnit));

  /** Locked AND still active (open contract/ticket) → shown locked, not removable. */
  readonly activeLockedTradeUnits = computed(() =>
    this.currentTradeUnits().filter(t => !t.isManual && t.isActive && t.hasOpenActivity).map(t => t.tradeUnit));

  /** Locked BUT dormant (no open contract/ticket) → shown with a remove button. Staged removals
   *  are filtered out so the chip disappears immediately on click. */
  readonly dormantTradeUnits = computed(() => {
    const removed = new Set(this.removedDormantTuCodes());
    return this.currentTradeUnits()
      .filter(t => !t.isManual && t.isActive && !t.hasOpenActivity && !removed.has(t.tradeUnit))
      .map(t => t.tradeUnit);
  });

  /** Codes the producer previously had but that are now removed (manual removal or a dormant
   *  sync-TU removal). Surfaced in the add-search so a removal can always be undone — including a
   *  TU that isn't in the entitlements catalog. Re-adding reactivates the row (and clears the
   *  dormant-removal flag) server-side via the manual reconcile on Save. */
  readonly reAddableTradeUnits = computed(() =>
    this.currentTradeUnits().filter(t => !t.isActive).map(t => t.tradeUnit));

  /** True when the editable manual TU set differs from what was loaded. */
  readonly manualTusChanged = computed(() => {
    const cur = [...this.selectedTuCodes()].sort();
    const orig = [...this._originalManualTuCodes].sort();
    return cur.length !== orig.length || cur.some((c, i) => c !== orig[i]);
  });

  /** Only reconcile trade units on save when the current list actually loaded (so we never
   *  deactivate everything from a failed load) AND there's something to do — onboarding a new
   *  candidate, or the manual set changed. */
  readonly canReconcileTradeUnits = computed(() =>
    this.tuListLoaded() && (this.isOnboardCandidate() || this.manualTusChanged()));

  /** True when the open customer isn't in our tables yet (an ODS search candidate).
   *  They must be assigned at least one trade unit (which inserts them) before any
   *  notes / producer-details can be saved. */
  readonly isOnboardCandidate = computed(() => !!this.customer()?.isOnboardCandidate);

  /** For a candidate with no trade unit selected yet, every other field (acres, bin
   *  capacity, commodities, primary contact, linked producers, eSign) is locked — there's
   *  nothing to attach them to until a TU assignment inserts the customer. Unlocks the
   *  moment a trade unit is picked. Existing customers are never locked. */
  readonly detailsLocked = computed(() => this.isOnboardCandidate() && this.selectedTuCodes().length === 0);

  /** TUs not already selected or locked, matched by CODE only. Capped for a tidy dropdown.
   *  The candidate pool is the entitlements TU catalog PLUS this producer's previously-removed
   *  memberships — so a removed TU is always re-addable, even one absent from the catalog. */
  readonly filteredTradeUnits = computed(() => {
    const taken = new Set([...this.selectedTuCodes(), ...this.lockedTradeUnits()]);
    const q = this.tuSearch().trim().toLowerCase();
    const catalog = this.allTradeUnits();
    // Match codes case-/whitespace-insensitively so a removed TU that IS in the catalog shows the
    // catalog entry (with its real description, e.g. "1028 NE/CO Truck") rather than a duplicate.
    const norm = (c: string) => c.trim().toLowerCase();
    const catalogCodes = new Set(catalog.map(tu => norm(tu.code)));
    // Removed memberships genuinely absent from the catalog — shown as just the code (no description
    // available), reading like any other option. Re-adding reactivates the row on Save.
    const reAddable = this.reAddableTradeUnits()
      .filter(code => !catalogCodes.has(norm(code)))
      .map(code => ({ code, description: undefined as string | undefined }));
    return [...catalog, ...reAddable]
      .filter(tu => !taken.has(tu.code))
      .filter(tu => !q || tu.code.toLowerCase().includes(q))
      .slice(0, 50);
  });

  editAcres: string = '';
  editBinCapacity: string = '';
  editCommodities = signal<string[]>([]);
  private _derivedCommoditySet = new Set<string>();
  editLinkedProducerIds = signal<string[]>([]);
  removedIncomingIds = signal<string[]>([]); // incoming links removed locally, saved on Save Changes
  editESignEnabled = signal(false);
  newCommodity = signal('');

  // ── Contacts (name + phone + email; exactly one primary) ────────────────
  editContacts = signal<{ name: string; phone: string; email: string; isPrimary: boolean }[]>([]);

  /** Rows that have details (phone/email) but no name can't be saved — the name is the key. */
  readonly contactsInvalid = computed(() =>
    this.editContacts().some(r => !r.name.trim() && (r.phone.trim() || r.email.trim())));

  /** Linking producers requires a named primary contact (it's what gets propagated to them). */
  readonly primaryContactName = computed(() =>
    this.editContacts().find(r => r.isPrimary)?.name.trim() ?? '');

  addContactRow(): void {
    this.editContacts.update(rows => [
      ...rows,
      { name: '', phone: '', email: '', isPrimary: rows.length === 0 }
    ]);
  }

  removeContactRow(index: number): void {
    this.editContacts.update(rows => {
      const next = rows.filter((_, i) => i !== index);
      // Deleting the primary row promotes the first remaining one.
      if (next.length > 0 && !next.some(r => r.isPrimary)) next[0] = { ...next[0], isPrimary: true };
      return next;
    });
  }

  setPrimaryContactRow(index: number): void {
    this.editContacts.update(rows => rows.map((r, i) => ({ ...r, isPrimary: i === index })));
  }

  onContactPhoneInput(index: number, value: string): void {
    this.editContacts.update(rows => rows.map((r, i) => i === index ? { ...r, phone: formatPhoneProgressive(value) } : r));
  }

  updateContactField(index: number, field: 'name' | 'email', value: string): void {
    this.editContacts.update(rows => rows.map((r, i) => i === index ? { ...r, [field]: value } : r));
  }

  /** Hydrates the contact rows from the customer's saved contacts; older cached data without a
   *  contacts array falls back to synthesizing one row from the legacy primary fields. */
  private _contactsFromCustomer(customer: Customer): { name: string; phone: string; email: string; isPrimary: boolean }[] {
    const saved = customer.contacts;
    if (saved && saved.length > 0) {
      return saved.map(c => ({
        name: c.name || '',
        phone: c.phone || '',
        email: c.email || '',
        isPrimary: !!c.isPrimary
      }));
    }
    if (customer.primaryContact || customer.primaryPhone) {
      return [{
        name: customer.primaryContact || '',
        phone: customer.primaryPhone || '',
        email: '',
        isPrimary: true
      }];
    }
    return [];
  }

  // ── Bin sites: Name | Capacity | Marketed | Unmarketed | Commodity | Lat/Long, as many as needed ───
  readonly maxBinSites = MAX_BIN_SITES;
  readonly binSiteNameMaxLength = BIN_SITE_NAME_MAX_LENGTH;
  readonly coordinateExample = COORDINATE_EXAMPLE;
  /** Bushel fields are kept as the displayed text ("50,000"); parseBinSiteCapacity reads the number. */
  editBinSites = signal<BinSiteEditRow[]>([]);

  /** Per-row validation message, or null. Only the Name is required (user 2026-10-09): a fully
   *  blank row is fine (dropped on save), a row with anything in it needs a name, coordinates are
   *  optional but must pass the North American rules when typed, and each bushel field shares the
   *  producer-level Bin Capacity ceiling. Blocks Save. */
  readonly binSiteErrors = computed(() =>
    this.editBinSites().map(r => {
      if (!r.coords.trim() && !binSiteRowHasData(r)) return null;
      if (!r.name.trim()) return 'Enter a name for this site.';
      if (r.coords.trim()) {
        const parsed = parseCoordinatePair(r.coords);
        if (!parsed.ok) return parsed.error;
      }
      const over = (['capacity', 'marketed', 'unmarketed'] as const)
        .find(f => (parseBinSiteCapacity(r[f]) ?? 0) > MAX_BIN_SITE_CAPACITY);
      return over
        ? `${BIN_SITE_BUSHEL_LABELS[over]} can be at most ${MAX_BIN_SITE_CAPACITY.toLocaleString('en-US')} bushels.`
        : null;
    }));

  /** Per-row warning, or null: Marketed + Unmarketed more than the site's Capacity. Shown, never
   *  blocks Save — the user may know something the numbers don't (user decision 2026-10-09). */
  readonly binSiteWarnings = computed(() =>
    this.editBinSites().map(r => {
      const capacity = parseBinSiteCapacity(r.capacity);
      const stored = (parseBinSiteCapacity(r.marketed) ?? 0) + (parseBinSiteCapacity(r.unmarketed) ?? 0);
      return capacity !== null && stored > capacity
        ? `Marketed + Unmarketed (${stored.toLocaleString('en-US')} bu) is more than the Capacity (${capacity.toLocaleString('en-US')} bu).`
        : null;
    }));

  readonly binSitesInvalid = computed(() => this.binSiteErrors().some(e => e !== null));

  /** Which input to outline in red: the name when a row has data but no name, the coordinates
   *  only when what was typed there doesn't parse — not for every row error. */
  readonly binSiteNameMissing = computed(() =>
    this.editBinSites().map(r => !r.name.trim() && (!!r.coords.trim() || binSiteRowHasData(r))));
  readonly binSiteCoordsInvalid = computed(() =>
    this.editBinSites().map(r => !!r.coords.trim() && !parseCoordinatePair(r.coords).ok));

  /** Commodity choices: the same scoped list Grain on Farm offers, without its "already used"
   *  filter — two sites can hold the same crop. */
  readonly binSiteCommodityOptions = computed(() => buildGrainOnFarmOptions({
    planting: this.scopedCommodities().filter(c => c.showInPlantingIntentions),
    used: [],
  }));

  /** True when a row's saved code isn't in today's list (deactivated, or another trade unit's crop),
   *  so the template can still show it as the selected option instead of a blank. */
  isUnlistedBinSiteCommodity(code: string): boolean {
    return !!code && !this.binSiteCommodityOptions().some(o => o.code === code);
  }

  addBinSiteRow(): void {
    this.editBinSites.update(rows => rows.length >= MAX_BIN_SITES ? rows : [...rows, emptyBinSiteRow()]);
  }

  removeBinSiteRow(index: number): void {
    this.editBinSites.update(rows => rows.filter((_, i) => i !== index));
    this._syncBinSiteCommodityChips();
  }

  updateBinSiteField(index: number, field: keyof BinSiteEditRow, value: string): void {
    this.editBinSites.update(rows => rows.map((r, i) => i === index ? { ...r, [field]: value } : r));
  }

  /** Bushel fields accept digits only and show them grouped as typed ("50000" → "50,000"). */
  onBinSiteBushelsInput(index: number, field: 'capacity' | 'marketed' | 'unmarketed', value: string): void {
    this.updateBinSiteField(index, field, formatBinSiteCapacityInput(value));
  }

  /** Kept for the capacity input's existing callers. */
  onBinSiteCapacityInput(index: number, value: string): void {
    this.onBinSiteBushelsInput(index, 'capacity', value);
  }

  /** Picking a commodity the producer doesn't list adds it to their Commodities chips, as Grain on
   *  Farm does; changing or clearing it takes back a chip that only this produced. */
  setBinSiteCommodity(index: number, code: string): void {
    this.updateBinSiteField(index, 'commodityCode', code);
    this._syncBinSiteCommodityChips();
  }

  /** The inline × in each input. */
  clearBinSiteField(index: number, field: keyof BinSiteEditRow): void {
    if (field === 'commodityCode') {
      this.setBinSiteCommodity(index, '');
      return;
    }
    this.updateBinSiteField(index, field, '');
  }

  /** Codes this dialog session put onto the Commodities chips because of a bin site — the bin-site
   *  twin of _grainAutoAddedCommodities, kept separate so neither list removes the other's chip. */
  private _binSiteAutoAddedCommodities = new Set<string>();

  /** Makes the chips match the bin sites: adds a chip for any site commodity the producer doesn't
   *  list (remembering it), and removes a remembered chip once no site uses it — unless a Grain on
   *  Farm row or that list's own auto-add still needs it. Never touches a chip the user, tickets or
   *  contracts put there. */
  private _syncBinSiteCommodityChips(): void {
    const key = (c: string) => c.trim().toLowerCase();
    const used = new Set(this.editBinSites().map(r => key(r.commodityCode)).filter(Boolean));
    for (const code of [...this._binSiteAutoAddedCommodities]) {
      if (used.has(key(code))) continue;
      this._binSiteAutoAddedCommodities.delete(code);
      const stillNeeded = this._grainAutoAddedCommodities.has(code)
        || this.editGrainOnFarm().some(g => key(g.commodityCode) === key(code));
      if (!stillNeeded) this.editCommodities.update(c => c.filter(x => key(x) !== key(code)));
    }
    for (const row of this.editBinSites()) {
      const code = row.commodityCode.trim();
      if (code && !this.editCommodities().some(c => key(c) === key(code))) {
        this.editCommodities.update(c => [...c, code]);
        this._binSiteAutoAddedCommodities.add(code);
      }
    }
  }

  /** On blur, rewrite a valid free-hand entry ("41.39 N, 95.01 W", degrees-minutes-seconds, …) as
   *  the standard "lat, lng" so the user sees exactly how it was read. Invalid text is left as typed
   *  so it can be fixed rather than lost. */
  normalizeBinSiteCoords(index: number): void {
    const row = this.editBinSites()[index];
    if (!row) return;
    const parsed = parseCoordinatePair(row.coords);
    if (!parsed.ok) return;
    const canonical = formatCoordinatePairFull(parsed.lat, parsed.lng);
    if (canonical !== row.coords) this.updateBinSiteField(index, 'coords', canonical);
  }

  private _binSitesFromCustomer(customer: Customer): BinSiteEditRow[] {
    const bushels = (v: number | null | undefined) => v != null ? formatBinSiteCapacityInput(String(v)) : '';
    return (customer.binSites ?? []).map(b => ({
      name: b.name ?? '',
      coords: b.latitude != null && b.longitude != null ? formatCoordinatePairFull(b.latitude, b.longitude) : '',
      capacity: bushels(b.capacity),
      marketed: bushels(b.marketed),
      unmarketed: bushels(b.unmarketed),
      commodityCode: b.commodityCode ?? ''
    }));
  }

  // Commodity lookup
  allCommodities = signal<Commodity[]>([]);

  /** The commodity list minus anything scoped to a trade group the user isn't currently in
   *  (the Organics & IP crops). Every user-facing read in this dialog goes through here, so the
   *  full-list fallback in _loadCommoditiesFallback() is covered too. */
  private readonly scopedCommodities = computed(() =>
    scopeCommodities(this.allCommodities(), { groupNames: this.appState.inScopeGroupNames(), tradeUnitCodes: this.appState.inScopeTradeUnitCodes() }));
  filteredCommodities = signal<Commodity[]>([]);
  showSuggestions = signal(false);

  // ── Grain on Farm (per commodity CODE: on-hand, grade, target) ──────────
  // Numbers are kept as strings for the inputs and parsed on save (mirrors editBinCapacity).
  // Rows are keyed by commodity code, the same values as the Commodities chips. A row saved before
  // 2026-09-23 may hold a crop-group name instead ("Corn"); it round-trips untouched and is flagged
  // in the template so the user can swap it for a code. See shared/utils/grain-on-farm.ts.
  editGrainOnFarm = signal<{ commodityCode: string; bushelsOnHand: string; targetBushels: string; grade: string }[]>([]);
  newGrainCode = signal(''); // commodity code selected in the "add row" dropdown

  /** Dropdown options: one list of every planting-intentions commodity the user's trade units can
   *  see — the same list the planting crop picker offers. */
  readonly grainOptions = computed(() => buildGrainOnFarmOptions({
    // The flag guard matters only in the full-catalog fallback (_loadCommoditiesFallback), where it
    // keeps a couple of thousand non-crop codes out; the planting list is all true.
    planting: this.scopedCommodities().filter(c => c.showInPlantingIntentions),
    used: this.editGrainOnFarm().map(r => r.commodityCode),
  }));

  /** Whether the grain "add a commodity" list is open. A custom list rather than a native <select>
   *  because the browser opens a native one upward near the bottom of the dialog, and that can't be
   *  overridden; this one always drops down, like the Commodities search below it. */
  grainPickerOpen = signal(false);
  /** Label for the picker button: the chosen commodity, or the placeholder. */
  readonly grainPickerLabel = computed(() =>
    this.grainOptions().find(o => o.code === this.newGrainCode())?.label ?? 'Add a commodity…');

  /** Keyboard-highlighted option while the list is open (-1 = none). */
  grainPickerActive = signal(-1);

  /** Arrow keys open the list and move the highlight, Enter picks it, Escape closes — what a native
   *  <select> gave keyboard users for free. */
  onGrainPickerKeydown(event: KeyboardEvent): void {
    const options = this.grainOptions();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!options.length) return;
      if (!this.grainPickerOpen()) {
        this.grainPickerOpen.set(true);
        const current = options.findIndex(o => o.code === this.newGrainCode());
        this.grainPickerActive.set(current >= 0 ? current : 0);
      } else {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.grainPickerActive.set((this.grainPickerActive() + step + options.length) % options.length);
      }
      queueMicrotask(() => document.getElementById(`grain-opt-${this.grainPickerActive()}`)?.scrollIntoView({ block: 'nearest' }));
    } else if (event.key === 'Enter' && this.grainPickerOpen()) {
      event.preventDefault();
      const picked = options[this.grainPickerActive()];
      if (picked) this.selectGrainOption(picked.code);
    } else if (event.key === 'Escape' && this.grainPickerOpen()) {
      event.preventDefault();
      event.stopPropagation(); // close the list, not the whole dialog
      this.grainPickerOpen.set(false);
    }
  }

  selectGrainOption(code: string): void {
    this.newGrainCode.set(code);
    this.grainPickerOpen.set(false);
    this.grainPickerActive.set(-1);
  }

  /** Close on blur, delayed so a mousedown on an option lands first (same as hideSuggestionsDelayed). */
  closeGrainPickerDelayed(): void {
    setTimeout(() => this.grainPickerOpen.set(false), 200);
  }

  private readonly _grainCommodityByCode = computed(() =>
    indexCommoditiesByCode(this.appState.commodities(), this.allCommodities()));
  private readonly _grainLookup = computed(() => buildCropGroupLookup([...this.appState.commodities(), ...this.allCommodities()]));

  /** Codes this dialog session put onto the Commodities chips because a grain row was added for
   *  a commodity the producer didn't have yet. Tracked so removing that grain row takes the chip
   *  back off — but never a chip the user or the producer's tickets/contracts already had. */
  private _grainAutoAddedCommodities = new Set<string>();

  /** A row still holding a pre-code crop-group name ("Corn"). Only a real group name qualifies, so a
   *  code missing from the active catalog is never flagged, and nothing is flagged before load. */
  isLegacyGrainRow(value: string): boolean {
    return isLegacyGrainGroup(value, this._grainCommodityByCode(), this._grainLookup());
  }

  /** Hover text for a row: the commodity name, or the legacy-row explanation. */
  grainRowTitle(value: string): string {
    return grainOnFarmTitle(value, this._grainCommodityByCode(), this._grainLookup());
  }

  /** Adds a grain row and, when the producer doesn't already list that commodity, adds it to their
   *  Commodities chips too (as a user-added, removable chip), so the two lists stay in step. */
  addGrainRow(): void {
    const code = this.newGrainCode().trim();
    if (!code || this.editGrainOnFarm().some(r => r.commodityCode.toLowerCase() === code.toLowerCase())) return;
    this.editGrainOnFarm.update(rows => [...rows, { commodityCode: code, bushelsOnHand: '', targetBushels: '', grade: '' }]);
    if (!this.editCommodities().some(c => c.toLowerCase() === code.toLowerCase())) {
      this.editCommodities.update(c => [...c, code]);
      this._grainAutoAddedCommodities.add(code);
    }
    this.newGrainCode.set('');
  }

  removeGrainRow(commodityCode: string): void {
    this.editGrainOnFarm.update(rows => rows.filter(r => r.commodityCode !== commodityCode));
    if (this._grainAutoAddedCommodities.delete(commodityCode)) {
      this.editCommodities.update(c => c.filter(x => x !== commodityCode));
    }
    // A bin site may still hold that commodity — put its chip back if so.
    this._syncBinSiteCommodityChips();
  }

  // ── Collapsible sections (edit dialog) ──────────────────────────────────
  // Each section header toggles its body so the dialog opens compact and the user
  // expands only what they need (less scrolling).
  private readonly _expandedSections = signal<Record<string, boolean>>({
    tradeUnits: true, farm: true, links: true,
  });
  isExpanded(key: string): boolean { return this._expandedSections()[key] ?? false; }
  toggleSection(key: string): void {
    this._expandedSections.update(s => ({ ...s, [key]: !s[key] }));
  }

  // Producer search
  // _allProducersForSearch caches the full cross-trade-unit list (only loaded when no trade units selected)
  private _allProducersForSearch: Customer[] = [];
  newProducerSearch = signal('');
  filteredProducers = signal<Customer[]>([]);
  showProducerSuggestions = signal(false);

  // Original values to track changes
  private _originalAcres: number = 0;
  private _originalBinCapacity: number = 0;
  private _originalCommodities: string[] = [];
  private _originalGrainOnFarm: string = '[]'; // serialized snapshot for change detection
  private _originalLinkedProducerIds: string[] = [];
  private _originalESignEnabled = false;
  private _originalContacts = '[]'; // serialized snapshot for change detection
  private _originalBinSites = '[]'; // serialized snapshot for change detection

  private _initialized = false;
  isLoadingCommodities = signal(false);
  isLoadingProducers = signal(false);

  constructor() {
    // Eagerly load the commodity picker list. Use the curated "Planting Intentions" list
    // (getPlantingCommodities) so producer-details shows the same clean commodity set as the rest
    // of the app, not the full ~250-code catalog. Falls back to the full list if the curated fetch
    // is empty/errors so the dropdown never goes blank. Already-selected / ticket-derived
    // commodities display as their own code chips, so they show regardless of this list.
    this.isLoadingCommodities.set(true);
    this.apiService.getPlantingCommodities().subscribe({
      next: (commodities) => {
        if (commodities.length > 0) {
          this.allCommodities.set(commodities);
          this.isLoadingCommodities.set(false);
          if (this.newCommodity().trim()) this.onCommoditySearch();
        } else {
          this._loadCommoditiesFallback();
        }
      },
      error: () => this._loadCommoditiesFallback()
    });

    effect(() => {
      const tradeUnits = this.selectedTradeUnits();
      // Eagerly load all producers whenever selectedTradeUnits becomes empty so the cache is
      // ready before the user opens the link search. Cached — only fetches once per session.
      if (tradeUnits.length === 0 && this._allProducersForSearch.length === 0 && !this.isLoadingProducers()) {
        this._loadAllProducersForSearch();
      }
    });

    effect(() => {
      const isOpen = this.isOpen();
      const customer = this.customer();

      // When isOpen becomes true, initialize the form from the customer
      if (isOpen && customer && !this._initialized) {
        this.editAcres = String(customer.totalAcres || 0);
        this.editBinCapacity = String(customer.binCapacity || 0);
        const ticketCommodities = [...new Set(
          this.tickets().map(t => t.productCode || '').filter(Boolean)
        )];
        const contractCommodities = [...new Set(
          this.contracts().map(c => c.commodityCode || '').filter(Boolean)
        )];
        this._derivedCommoditySet = new Set([...ticketCommodities, ...contractCommodities]);
        const userCommodities = customer.commodities || [];
        this.editCommodities.set([...new Set([...ticketCommodities, ...contractCommodities, ...userCommodities])].sort());
        this.editLinkedProducerIds.set([...(customer.linkedProducerIds || [])]);
        this.removedIncomingIds.set([]);
        this.editESignEnabled.set(customer.eSignEnabled);
        this.editContacts.set(this._contactsFromCustomer(customer));
        this.editBinSites.set(this._binSitesFromCustomer(customer));
        this.editGrainOnFarm.set((customer.grainOnFarm || []).map(g => ({
          commodityCode: g.commodityCode,
          bushelsOnHand: g.bushelsOnHand != null ? String(g.bushelsOnHand) : '',
          targetBushels: g.targetBushels != null ? String(g.targetBushels) : '',
          grade: g.grade ?? ''
        })));
        this.newGrainCode.set('');
        this._grainAutoAddedCommodities.clear();
        this._binSiteAutoAddedCommodities.clear();
        this.grainPickerOpen.set(false);

        // Store original values
        this._originalAcres = customer.totalAcres || 0;
        this._originalBinCapacity = customer.binCapacity || 0;
        this._originalCommodities = [...this.editCommodities()];
        this._originalGrainOnFarm = this._serializeGrain();
        this._originalLinkedProducerIds = [...(customer.linkedProducerIds || [])];
        this._originalESignEnabled = customer.eSignEnabled;
        this._originalContacts = this._serializeContacts();
        this._originalBinSites = this._serializeBinSites();

        // If no trade units and the cache still isn't loaded (edge case: first open before effect
        // on selectedTradeUnits fired), kick off the load now.
        if (this.selectedTradeUnits().length === 0 && this._allProducersForSearch.length === 0 && !this.isLoadingProducers()) {
          this._loadAllProducersForSearch();
        }

        // Trade-unit section — reset, lazy-load the full TU catalog (for the add-search),
        // and load this producer's current memberships so we can show locked (sync) chips
        // and prefill the editable (manual) ones.
        this.selectedTuCodes.set([]);
        this.tuSearch.set('');
        this.currentTradeUnits.set([]);
        this.removedDormantTuCodes.set([]);
        this.tuListLoaded.set(false);
        this._originalManualTuCodes = [];
        // Planting-intention state is per producer: drop it so the next removal re-checks.
        this._plantingByTu.set(new Map());
        this._plantingLoaded = false;
        this._stagedIntentionMoves.set(new Map());
        this.tuRemovalPrompt.set(null);
        this.tuRemovalTarget.set('');
        if (this.allTradeUnits().length === 0 && !this.isLoadingTradeUnits()) {
          this.isLoadingTradeUnits.set(true);
          this.apiService.getAllTradeUnits().subscribe({
            next: (tus) => { this.allTradeUnits.set(tus); this.isLoadingTradeUnits.set(false); },
            error: () => { this.isLoadingTradeUnits.set(false); }
          });
        }
        this.currentTradeUnitsError.set(null);
        // A not-yet-onboarded candidate isn't in dbo.Customer, so it has no memberships — skip
        // the fetch and treat the list as loaded+empty.
        if (customer.isOnboardCandidate) {
          this.tuListLoaded.set(true);
        } else {
          this._loadCurrentTradeUnits(customer.id);
        }

        this._initialized = true;
      }

      // Reset initialized flag when dialog closes
      if (!isOpen) {
        this._initialized = false;
      }
    });

    // For a candidate, removing all trade units re-locks the other fields — clear anything
    // that was typed, since it can't be saved without an assignment anchoring the customer.
    effect(() => {
      const locked = this.detailsLocked();
      if (locked && this._initialized) {
        untracked(() => this._clearDetailFields());
      }
    });
  }

  private _clearDetailFields(): void {
    this.editAcres = '';
    this.editBinCapacity = '';
    this.editCommodities.set([]);
    this.editGrainOnFarm.set([]);
    this.newGrainCode.set('');
    this._grainAutoAddedCommodities.clear();
    this._binSiteAutoAddedCommodities.clear();
    this.grainPickerOpen.set(false);
    this.grainPickerActive.set(-1);
    this.editContacts.set([]);
    this.editBinSites.set([]);
    this.editLinkedProducerIds.set([]);
    this.removedIncomingIds.set([]);
    this.editESignEnabled.set(false);
    this.newCommodity.set('');
    this.showSuggestions.set(false);
    this.newProducerSearch.set('');
    this.showProducerSuggestions.set(false);
  }

  /** Loads this producer's current trade-unit memberships. On error, surfaces the failure
   *  (error signal + toast) and leaves tuListLoaded false so a failed load can't reconcile the
   *  producer's manual assignments to empty on Save. Used on open and by retry. */
  private _loadCurrentTradeUnits(customerId: number): void {
    this.isLoadingCurrentTradeUnits.set(true);
    this.currentTradeUnitsError.set(null);
    this.apiService.getCustomerTradeUnits(customerId).subscribe({
      next: (tus) => {
        this.currentTradeUnits.set(tus);
        // Only ACTIVE manual memberships prefill the editable set — removed ones (isActive=false)
        // are offered as re-addable suggestions instead, not pre-selected.
        const manualCodes = tus.filter(t => t.isManual && t.isActive).map(t => t.tradeUnit);
        this.selectedTuCodes.set(manualCodes);
        this._originalManualTuCodes = [...manualCodes];
        this.tuListLoaded.set(true);
        this.isLoadingCurrentTradeUnits.set(false);
      },
      // Leave tuListLoaded false on error — canReconcileTradeUnits then stays false so a
      // failed load can't wipe the producer's manual assignments on save.
      error: (e: Error) => {
        this.tuListLoaded.set(false);
        this.isLoadingCurrentTradeUnits.set(false);
        this.currentTradeUnitsError.set(e?.message || 'Couldn\'t load trade units.');
        this.toast.error(e?.message || 'Couldn\'t load this producer\'s trade units.');
      }
    });
  }

  /** Retry the membership load after a transient failure (from the inline Retry button). */
  retryLoadCurrentTradeUnits(): void {
    const customer = this.customer();
    if (!customer || customer.isOnboardCandidate) return;
    this._loadCurrentTradeUnits(customer.id);
  }

  // ── Trade-unit assignment actions ───────────────────────────────────────
  addTradeUnit(code: string): void {
    if (!code || this.selectedTuCodes().includes(code)) return;
    this.selectedTuCodes.update(list => [...list, code]);
    this.tuSearch.set('');
    // Re-adding a trade unit undoes its removal, so any staged move of its acres is moot.
    this._clearStagedMove(code);
  }

  /** Remove a manual assignment. Asks where the acres go first when this producer has planting
   *  intentions recorded against the trade unit. */
  removeTradeUnit(code: string): void {
    this._beginTradeUnitRemoval(code, 'manual');
  }

  /** Stage removal of a dormant LOCKED trade unit (committed on Save). Only dormant chips expose
   *  this; the server re-validates dormancy when the DELETE runs in onSave(). */
  removeDormantTradeUnit(code: string): void {
    this._beginTradeUnitRemoval(code, 'dormant');
  }

  /** The removal itself — what the two handlers above used to do directly. */
  private _applyTradeUnitRemoval(code: string, kind: 'manual' | 'dormant'): void {
    if (kind === 'manual') {
      this.selectedTuCodes.update(list => list.filter(c => c !== code));
      return;
    }
    if (!this.removedDormantTuCodes().includes(code)) {
      this.removedDormantTuCodes.update(list => [...list, code]);
    }
  }

  /**
   * Removes the trade unit straight away when no planting intentions are recorded against it,
   * otherwise opens the prompt. The intention list is fetched once, on demand. A failed fetch
   * removes the trade unit rather than blocking the user — the rows stay visible on the profile
   * (flagged as no longer assigned) and in the audit script.
   */
  private _beginTradeUnitRemoval(code: string, kind: 'manual' | 'dormant'): void {
    const customer = this.customer();
    if (!customer || customer.isOnboardCandidate) {
      this._applyTradeUnitRemoval(code, kind);
      return;
    }
    if (this._plantingLoaded) {
      this._promptOrRemove(code, kind);
      return;
    }
    this.isCheckingPlantingIntentions.set(true);
    this.apiService.getPlantingIntentionsByCustomer(customer.id).subscribe({
      next: rows => {
        const byTu = new Map<string, { count: number; acres: number; years: number[] }>();
        for (const row of rows) {
          const tu = (row.tradeUnit || '').trim();
          if (!tu) continue;
          const entry = byTu.get(tu) ?? { count: 0, acres: 0, years: [] };
          entry.count += 1;
          entry.acres += row.acres;
          if (!entry.years.includes(row.plantingYear)) entry.years.push(row.plantingYear);
          byTu.set(tu, entry);
        }
        for (const entry of byTu.values()) entry.years.sort((a, b) => b - a);
        this._plantingByTu.set(byTu);
        this._plantingLoaded = true;
        this.isCheckingPlantingIntentions.set(false);
        this._promptOrRemove(code, kind);
      },
      error: () => {
        this.isCheckingPlantingIntentions.set(false);
        this._plantingLoaded = true; // don't re-fetch on every chip click
        this._applyTradeUnitRemoval(code, kind);
      }
    });
  }

  private _promptOrRemove(code: string, kind: 'manual' | 'dormant'): void {
    const stats = this._plantingByTu().get(code);
    if (!stats || stats.count === 0) {
      this._applyTradeUnitRemoval(code, kind);
      return;
    }
    const targets = this._remainingTradeUnitsAfterRemoving(code);
    this.tuRemovalTarget.set(targets.length === 1 ? targets[0] : '');
    this.tuRemovalPrompt.set({ code, kind, count: stats.count, acres: stats.acres, years: stats.years, targets });
  }

  /**
   * Where the acres could go: the trade units this producer keeps once the staged edits apply.
   * Restricted to memberships that are already active, so a trade unit added in this same dialog
   * (not yet saved) is never offered — that move would race the assignment and be rejected.
   */
  private _remainingTradeUnitsAfterRemoving(code: string): string[] {
    const activeNow = new Set(this.currentTradeUnits().filter(t => t.isActive).map(t => t.tradeUnit));
    const keeping = new Set<string>([
      ...this.activeLockedTradeUnits(),
      ...this.dormantTradeUnits(),
      ...this.selectedTuCodes(),
    ]);
    return [...keeping].filter(c => c !== code && activeNow.has(c)).sort();
  }

  /** Confirm the removal, moving the acres to the chosen trade unit (or leaving them if none). */
  confirmTradeUnitRemoval(): void {
    const prompt = this.tuRemovalPrompt();
    if (!prompt) return;
    const target = this.tuRemovalTarget();
    if (target) {
      this._stagedIntentionMoves.update(map => new Map(map).set(prompt.code, target));
    } else {
      this._clearStagedMove(prompt.code);
    }
    this._applyTradeUnitRemoval(prompt.code, prompt.kind);
    this.tuRemovalPrompt.set(null);
    this.tuRemovalTarget.set('');
  }

  /** Back out — the trade unit stays and nothing moves. */
  cancelTradeUnitRemoval(): void {
    this.tuRemovalPrompt.set(null);
    this.tuRemovalTarget.set('');
  }

  private _clearStagedMove(code: string): void {
    if (!this._stagedIntentionMoves().has(code)) return;
    this._stagedIntentionMoves.update(map => {
      const next = new Map(map);
      next.delete(code);
      return next;
    });
  }

  /** Save is blocked for a not-yet-onboarded candidate until at least one trade unit is
   *  picked — that assignment is what inserts them into our tables. */
  readonly canSave = computed(() => !this.isOnboardCandidate() || this.selectedTuCodes().length > 0);

  hasChanges(): boolean {
    if (!this.customer()) return false;
    // Adding or removing a manual trade unit is itself a change (covers onboarding a fresh
    // candidate, and removing a manual TU from an existing producer with no other edits).
    if (this.manualTusChanged()) return true;
    // Staging a dormant locked-TU removal is also a change.
    if (this.removedDormantTuCodes().length > 0) return true;

    const linkedProducerIdsChanged = this.editLinkedProducerIds().length !== this._originalLinkedProducerIds.length
      || this.editLinkedProducerIds().some(id => !this._originalLinkedProducerIds.includes(id));

    const commoditiesChanged = this.editCommodities().length !== this._originalCommodities.length
      || this.editCommodities().some(c => !this._originalCommodities.includes(c));

    return this._parseNumericInput(this.editAcres) !== this._originalAcres
      || this._parseNumericInput(this.editBinCapacity) !== this._originalBinCapacity
      || commoditiesChanged
      || this._serializeGrain() !== this._originalGrainOnFarm
      || this.editESignEnabled() !== this._originalESignEnabled
      || this._serializeContacts() !== this._originalContacts
      || this._serializeBinSites() !== this._originalBinSites
      || linkedProducerIdsChanged
      || this.removedIncomingIds().length > 0;
  }

  /** Stable serialization of the grain-on-farm rows for change detection (order-independent). */
  private _serializeGrain(): string {
    return JSON.stringify(
      this.editGrainOnFarm()
        .map(r => ({ g: r.commodityCode, h: r.bushelsOnHand.trim(), t: r.targetBushels.trim(), gr: r.grade.trim() }))
        .sort((a, b) => a.g.localeCompare(b.g))
    );
  }

  /** Serialization of the contact rows for change detection. Deliberately ORDER-DEPENDENT —
   *  row order is the saved display order, so reordering counts as a change. Fully-blank rows
   *  are skipped so adding-then-clearing a row doesn't read as dirty. */
  private _serializeContacts(): string {
    return JSON.stringify(
      this.editContacts()
        .filter(r => r.name.trim() || r.phone.trim() || r.email.trim())
        .map(r => ({ n: r.name.trim(), p: r.phone.trim(), e: r.email.trim(), pr: r.isPrimary }))
    );
  }

  /** Same rules as the contacts serialization: order-dependent, fully-blank rows skipped. */
  private _serializeBinSites(): string {
    return JSON.stringify(
      this.editBinSites()
        .filter(r => r.coords.trim() || binSiteRowHasData(r))
        .map(r => ({
          n: r.name.trim(), c: r.coords.trim(), cap: parseBinSiteCapacity(r.capacity),
          m: parseBinSiteCapacity(r.marketed), u: parseBinSiteCapacity(r.unmarketed), cc: r.commodityCode.trim(),
        }))
    );
  }

  addCommodity(): void {
    const commodity = this.newCommodity().trim();
    if (commodity && !this.editCommodities().includes(commodity)) {
      this.editCommodities.update(c => [...c, commodity]);
      this.newCommodity.set('');
    }
  }

  isTicketCommodity(commodity: string): boolean {
    return this._derivedCommoditySet.has(commodity);
  }

  removeCommodity(commodity: string): void {
    if (this.isTicketCommodity(commodity)) return;
    this.editCommodities.update(c => c.filter(x => x !== commodity));
  }

  private readonly _commodityAliases: Record<string, string[]> = {
    'milo': ['milo', 'sorghum', 'sor', 'sg'],
    'sorghum': ['milo', 'sorghum', 'sor', 'sg'],
    'beans': ['soybeans', 'soy', 'beans', 'sb'],
    'soy': ['soybeans', 'soy', 'beans', 'sb'],
  };

  /** Safety net: load the full commodity list if the curated list is empty/unavailable, so the
   *  picker never blanks. */
  private _loadCommoditiesFallback(): void {
    this.apiService.getCommodities().subscribe({
      next: (commodities) => {
        this.allCommodities.set(commodities);
        this.isLoadingCommodities.set(false);
        if (this.newCommodity().trim()) this.onCommoditySearch();
      },
      error: () => { this.isLoadingCommodities.set(false); }
    });
  }

  onCommoditySearch(): void {
    const term = this.newCommodity().trim().toLowerCase();
    if (!term) {
      this.filteredCommodities.set([]);
      return;
    }
    const searchTerms = this._commodityAliases[term] ?? [term];
    this.filteredCommodities.set(this.scopedCommodities().filter(c => {
      const name = c.name.toLowerCase();
      const code = c.code.toLowerCase();
      return searchTerms.some(t => name.includes(t) || code.includes(t))
        && !this.editCommodities().includes(c.code);
    }));
    this.showSuggestions.set(true);
  }

  selectCommodity(commodity: Commodity): void {
    if (!this.editCommodities().includes(commodity.code)) {
      this.editCommodities.update(c => [...c, commodity.code]);
    }
    this.newCommodity.set('');
    this.filteredCommodities.set([]);
    this.showSuggestions.set(false);
  }

  selectFirstSuggestion(): void {
    if (this.filteredCommodities().length > 0) {
      this.selectCommodity(this.filteredCommodities()[0]);
    }
  }

  clearZeroOnFocus(field: 'editAcres' | 'editBinCapacity'): void {
    if (this[field] === '0') {
      this[field] = '';
    }
  }

  normalizeNumericOnBlur(field: 'editAcres' | 'editBinCapacity'): void {
    const num = this._parseNumericInput(this[field]);
    this[field] = String(num);
  }

  private _parseNumericInput(value: string): number {
    const digits = value.replace(/[^0-9]/g, '');
    const num = parseInt(digits, 10);
    return isNaN(num) ? 0 : num;
  }

  /** Parses a number that may contain a decimal point (e.g. the grain-on-farm target like "5.5").
   *  Strips everything except digits and a dot, then parses as a float. */
  private _parseDecimalInput(value: string): number {
    const cleaned = value.replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  clearCommoditySearch(): void {
    this.newCommodity.set('');
    this.filteredCommodities.set([]);
    this.showSuggestions.set(false);
  }

  hideSuggestionsDelayed(): void {
    // Delay to allow mousedown on suggestion to fire first
    setTimeout(() => { this.showSuggestions.set(false); }, 200);
  }

  private _loadAllProducersForSearch(): void {
    this.isLoadingProducers.set(true);
    // Pass no trade-units filter — backend GetCustomersAsync returns every customer
    // when the parameter is null/empty (see SqlDataService.cs). Previously this called
    // getTradeUnits() first just to round-trip the codes back as a scope, which was
    // dead weight once the local TU catalog was retired.
    this.apiService.getCustomers().subscribe({
      next: (customers) => {
        this._allProducersForSearch = customers;
        this.isLoadingProducers.set(false);
        // If the user already typed in the search box, refresh results now that data is loaded
        if (this.newProducerSearch().trim()) {
          this.onProducerSearch();
        }
      },
      error: () => {
        this.isLoadingProducers.set(false);
      }
    });
  }

  private get _producerPool(): Customer[] {
    // No trade units selected → use the full cross-trade-unit cache
    // Trade units selected → use the already-loaded filtered list (instant, no extra API call)
    return this.selectedTradeUnits().length === 0
      ? this._allProducersForSearch
      : this.allCustomers();
  }

  getProducerById(producerId: string): Customer | undefined {
    return this._producerPool.find(c => c.scoularId === producerId)
      ?? this.linkedCustomers().find(c => c.scoularId === producerId)
      ?? this.allCustomers().find(c => c.scoularId === producerId);
  }

  getProducersLinkingToMe(): Customer[] {
    if (!this.customer()) return [];
    const mySourceId = this.customer()!.scoularId || '';
    return this._producerPool.filter(c =>
      c.linkedProducerIds &&
      c.linkedProducerIds.includes(mySourceId) &&
      !this.removedIncomingIds().includes(c.scoularId || '')
    );
  }

  onProducerSearch(): void {
    const term = this.newProducerSearch().trim().toLowerCase();
    if (!term) {
      this.filteredProducers.set([]);
      return;
    }
    const currentCustomer = this.customer();
    this.filteredProducers.set(this._producerPool.filter(c =>
      c.id !== currentCustomer?.id &&
      !this.editLinkedProducerIds().includes(c.scoularId || '') &&
      (
        c.name.toLowerCase().includes(term) ||
        c.id.toString().includes(term) ||
        (c.scoularId || '').toLowerCase().includes(term)
      )
    ));
    this.showProducerSuggestions.set(true);
  }

  selectProducer(producer: Customer): void {
    const idStr = producer.scoularId || producer.id.toString();
    if (!this.editLinkedProducerIds().includes(idStr)) {
      this.editLinkedProducerIds.update(ids => [...ids, idStr]);
    }
    this.newProducerSearch.set('');
    this.filteredProducers.set([]);
    this.showProducerSuggestions.set(false);
  }

  hideProducerSuggestionsDelayed(): void {
    setTimeout(() => { this.showProducerSuggestions.set(false); }, 200);
  }

  removeLinkedProducer(producerId: string): void {
    this.editLinkedProducerIds.update(ids => ids.filter(id => id !== producerId));
  }

  removeIncomingLink(producerId: string): void {
    if (!this.removedIncomingIds().includes(producerId)) {
      this.removedIncomingIds.update(ids => [...ids, producerId]);
    }
  }

  onCancel(): void {
    // Reset all fields back to original values
    this.editAcres = String(this._originalAcres || 0);
    this.editBinCapacity = String(this._originalBinCapacity || 0);
    this.editCommodities.set([...this._originalCommodities]);
    this.editGrainOnFarm.set((this.customer()?.grainOnFarm || []).map(g => ({
      commodityCode: g.commodityCode,
      bushelsOnHand: g.bushelsOnHand != null ? String(g.bushelsOnHand) : '',
      targetBushels: g.targetBushels != null ? String(g.targetBushels) : '',
      grade: g.grade ?? ''
    })));
    this.newGrainCode.set('');
    this._grainAutoAddedCommodities.clear();
    this._binSiteAutoAddedCommodities.clear();
    this.grainPickerOpen.set(false);
    this.grainPickerActive.set(-1);
    this.editLinkedProducerIds.set([...this._originalLinkedProducerIds]);
    this.removedIncomingIds.set([]);
    this.editESignEnabled.set(this._originalESignEnabled);
    // Cancelling drops the staged trade-unit removals, so the acre moves they carried go too.
    this._stagedIntentionMoves.set(new Map());
    this.tuRemovalPrompt.set(null);
    this.tuRemovalTarget.set('');
    const customer = this.customer();
    this.editContacts.set(customer ? this._contactsFromCustomer(customer) : []);
    this.editBinSites.set(customer ? this._binSitesFromCustomer(customer) : []);
    this.newCommodity.set('');
    this.filteredCommodities.set([]);
    this.showSuggestions.set(false);
    this.newProducerSearch.set('');
    this.filteredProducers.set([]);
    this.showProducerSuggestions.set(false);
    this._initialized = false;
    this.close.emit();
  }

  onSave(): void {
    const customer = this.customer();
    if (customer) {
      // Commit any staged dormant locked-TU removals (separate from the manual reconcile the
      // parent runs from the emitted payload — these are sync-sourced rows, a distinct DELETE
      // per code). The server re-validates dormancy and returns 409 if the producer is actually
      // still active in that TU, in which case we surface a toast (chip stays removed locally but
      // wasn't committed; reopening the dialog will show it again from the refreshed list).
      const dormantRemovals = this.removedDormantTuCodes();
      for (const code of dormantRemovals) {
        this.apiService.removeDormantTradeUnit(customer.id, code).subscribe({
          error: () => this.toast.error(`Couldn't remove trade unit ${code} — the producer may still have an open contract or ticket there.`)
        });
      }


      // Contacts: drop fully-blank rows, normalize to exactly one primary. Rows with details but
      // no name are blocked before this point (contactsInvalid gates the Save button).
      const contactRows = this.editContacts()
        .filter(r => r.name.trim())
        .map(r => ({
          name: r.name.trim().slice(0, 200),
          phone: r.phone.trim().slice(0, 50) || undefined,
          email: r.email.trim().slice(0, 255) || undefined,
          isPrimary: r.isPrimary
        }));
      if (contactRows.length > 0 && !contactRows.some(r => r.isPrimary)) contactRows[0].isPrimary = true;
      const primaryRow = contactRows.find(r => r.isPrimary);

      // Bin sites: drop fully-blank rows (no name — Save is disabled for a row with data but no
      // name). Coordinates are optional; any that were typed parsed cleanly or Save was disabled
      // (binSitesInvalid), so the parse here only re-reads the values.
      const binSites = this.editBinSites().flatMap(r => {
        const name = r.name.trim().slice(0, BIN_SITE_NAME_MAX_LENGTH);
        if (!name) return [];
        const parsed = r.coords.trim() ? parseCoordinatePair(r.coords) : null;
        return [{
          name,
          latitude: parsed?.ok ? parsed.lat : undefined,
          longitude: parsed?.ok ? parsed.lng : undefined,
          capacity: parseBinSiteCapacity(r.capacity) ?? undefined,
          commodityCode: r.commodityCode.trim() || undefined,
          marketed: parseBinSiteCapacity(r.marketed) ?? undefined,
          unmarketed: parseBinSiteCapacity(r.unmarketed) ?? undefined,
        }];
      });

      // Only save user-added commodities to ProducerDetails — ticket-derived ones are
      // always re-derived fresh from current tickets, so they should never be persisted.
      this.save.emit({
        customerId: customer.id,
        acres: this._parseNumericInput(this.editAcres),
        binCapacity: this._parseNumericInput(this.editBinCapacity),
        commodities: this.editCommodities().filter(c => !this.isTicketCommodity(c)),
        primaryContact: primaryRow?.name ?? '',
        primaryPhone: primaryRow?.phone ?? '',
        contacts: contactRows,
        binSites,
        linkedProducerIds: this.editLinkedProducerIds(),
        removedIncomingIds: this.removedIncomingIds(),
        eSignEnabled: this.editESignEnabled(),
        tradeUnitCodes: this.selectedTuCodes(),
        reconcileTradeUnits: this.canReconcileTradeUnits(),
        grainOnFarm: this.editGrainOnFarm()
          .filter(r => r.commodityCode)
          .map(r => ({
            commodityCode: r.commodityCode,
            bushelsOnHand: r.bushelsOnHand.trim() ? this._parseNumericInput(r.bushelsOnHand) : undefined,
            targetBushels: r.targetBushels.trim() ? this._parseDecimalInput(r.targetBushels) : undefined,
            grade: r.grade.trim() || undefined
          })),
        intentionMoves: [...this._stagedIntentionMoves()].map(([from, to]) => ({ from, to }))
      });
      this._initialized = false;
      this.close.emit();
    }
  }
}
