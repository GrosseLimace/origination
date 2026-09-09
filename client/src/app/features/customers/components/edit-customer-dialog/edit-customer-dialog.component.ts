import { Component, input, output, effect, inject, signal, computed, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent } from '@shared/components/dialog/dialog.component';
import { Customer, Contract, Ticket, Commodity } from '@models';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { formatPhoneProgressive } from '@shared/utils/phone';
import { scopeCommodities } from '@shared/utils/commodity-scope';
import { AppStateService } from '@core/services/app-state.service';

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
    linkedProducerIds: string[];
    removedIncomingIds: string[];
    eSignEnabled: boolean;
    tradeUnitCodes: string[];        // Desired ACTIVE manual TU set — reconciled on "Save Changes".
    reconcileTradeUnits: boolean;    // Only reconcile when it's safe + meaningful (see canReconcileTradeUnits).
    grainOnFarm: { commodityGroup: string; bushelsOnHand?: number; targetBushels?: number; grade?: string }[];
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

  // Commodity lookup
  allCommodities = signal<Commodity[]>([]);

  /** The commodity list minus anything scoped to a trade group the user isn't currently in
   *  (the Organics & IP crops). Every user-facing read in this dialog goes through here, so the
   *  full-list fallback in _loadCommoditiesFallback() is covered too. */
  private readonly scopedCommodities = computed(() =>
    scopeCommodities(this.allCommodities(), { groupNames: this.appState.inScopeGroupNames(), tradeUnitCodes: this.appState.inScopeTradeUnitCodes() }));
  filteredCommodities = signal<Commodity[]>([]);
  showSuggestions = signal(false);

  // ── Grain on Farm (per commodity GROUP: on-hand + target) ───────────────
  // Numbers are kept as strings for the inputs and parsed on save (mirrors editBinCapacity).
  editGrainOnFarm = signal<{ commodityGroup: string; bushelsOnHand: string; targetBushels: string; grade: string }[]>([]);
  newGrainGroup = signal(''); // commodity group selected in the "add row" dropdown
  /** Commodity groups never offered for Grain on Farm (title-cased, matched case-insensitively). */
  private static readonly HIDDEN_GRAIN_GROUPS = new Set(['other grain']);

  /** Distinct commodity groups (Commodity.category — e.g. Corn, Wheat, Soybeans) not yet added,
   *  for the add dropdown. Sourced from the curated commodity list the dialog already loads.
   *  "Other Grain" is excluded — it's not a meaningful on-farm grain category. */
  readonly availableGrainGroups = computed(() => {
    const used = new Set(this.editGrainOnFarm().map(r => r.commodityGroup));
    const groups = new Set<string>();
    for (const c of this.scopedCommodities()) {
      const g = this._titleCaseGroup(c.category);
      if (g && !used.has(g) && !EditCustomerDialogComponent.HIDDEN_GRAIN_GROUPS.has(g.toLowerCase())) {
        groups.add(g);
      }
    }
    return [...groups].sort((a, b) => a.localeCompare(b));
  });

  /** Normalizes a group label to title case so the data's ALL-CAPS categories
   *  ("CORN", "FEED & FERT INGREDIENTS") read as "Corn", "Feed & Fert Ingredients". */
  private _titleCaseGroup(value: string | undefined): string {
    return (value || '').trim().toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase());
  }

  addGrainRow(): void {
    const group = this.newGrainGroup().trim();
    if (!group || this.editGrainOnFarm().some(r => r.commodityGroup === group)) return;
    this.editGrainOnFarm.update(rows => [...rows, { commodityGroup: group, bushelsOnHand: '', targetBushels: '', grade: '' }]);
    this.newGrainGroup.set('');
  }

  removeGrainRow(commodityGroup: string): void {
    this.editGrainOnFarm.update(rows => rows.filter(r => r.commodityGroup !== commodityGroup));
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
        this.editGrainOnFarm.set((customer.grainOnFarm || []).map(g => ({
          commodityGroup: g.commodityGroup,
          bushelsOnHand: g.bushelsOnHand != null ? String(g.bushelsOnHand) : '',
          targetBushels: g.targetBushels != null ? String(g.targetBushels) : '',
          grade: g.grade ?? ''
        })));
        this.newGrainGroup.set('');

        // Store original values
        this._originalAcres = customer.totalAcres || 0;
        this._originalBinCapacity = customer.binCapacity || 0;
        this._originalCommodities = [...this.editCommodities()];
        this._originalGrainOnFarm = this._serializeGrain();
        this._originalLinkedProducerIds = [...(customer.linkedProducerIds || [])];
        this._originalESignEnabled = customer.eSignEnabled;
        this._originalContacts = this._serializeContacts();

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
    this.newGrainGroup.set('');
    this.editContacts.set([]);
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
  }

  removeTradeUnit(code: string): void {
    this.selectedTuCodes.update(list => list.filter(c => c !== code));
  }

  /** Stage removal of a dormant LOCKED trade unit (committed on Save). Only dormant chips expose
   *  this; the server re-validates dormancy when the DELETE runs in onSave(). */
  removeDormantTradeUnit(code: string): void {
    if (!this.removedDormantTuCodes().includes(code)) {
      this.removedDormantTuCodes.update(list => [...list, code]);
    }
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
      || linkedProducerIdsChanged
      || this.removedIncomingIds().length > 0;
  }

  /** Stable serialization of the grain-on-farm rows for change detection (order-independent). */
  private _serializeGrain(): string {
    return JSON.stringify(
      this.editGrainOnFarm()
        .map(r => ({ g: r.commodityGroup, h: r.bushelsOnHand.trim(), t: r.targetBushels.trim(), gr: r.grade.trim() }))
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
      commodityGroup: g.commodityGroup,
      bushelsOnHand: g.bushelsOnHand != null ? String(g.bushelsOnHand) : '',
      targetBushels: g.targetBushels != null ? String(g.targetBushels) : '',
      grade: g.grade ?? ''
    })));
    this.newGrainGroup.set('');
    this.editLinkedProducerIds.set([...this._originalLinkedProducerIds]);
    this.removedIncomingIds.set([]);
    this.editESignEnabled.set(this._originalESignEnabled);
    const customer = this.customer();
    this.editContacts.set(customer ? this._contactsFromCustomer(customer) : []);
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
        linkedProducerIds: this.editLinkedProducerIds(),
        removedIncomingIds: this.removedIncomingIds(),
        eSignEnabled: this.editESignEnabled(),
        tradeUnitCodes: this.selectedTuCodes(),
        reconcileTradeUnits: this.canReconcileTradeUnits(),
        grainOnFarm: this.editGrainOnFarm()
          .filter(r => r.commodityGroup)
          .map(r => ({
            commodityGroup: r.commodityGroup,
            bushelsOnHand: r.bushelsOnHand.trim() ? this._parseNumericInput(r.bushelsOnHand) : undefined,
            targetBushels: r.targetBushels.trim() ? this._parseDecimalInput(r.targetBushels) : undefined,
            grade: r.grade.trim() || undefined
          }))
      });
      this._initialized = false;
      this.close.emit();
    }
  }
}
