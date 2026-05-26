import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '@core/services/api.service';
import {
  DialogComponent,
  DialogHeaderComponent,
  DialogTitleComponent,
  DialogDescriptionComponent,
  DialogFooterComponent,
} from '@shared/components/dialog/dialog.component';
import { DeliveryMethod, MemberType, RecapGroup, RecapMember } from '@features/daily-digest/models/recap-group.model';
import { EntitlementsCatalog } from '@features/daily-digest/models/entitlements-catalog.model';

type MemberTab = 'people' | 'trade-units' | 'groups';

/**
 * Daily Digest configuration page. Lets a user build / edit Recap Groups —
 * a named set of recipients (people, trade units, trade-unit groups) plus
 * optional CC addresses, marked enabled or disabled.
 *
 * Logic App (external) reads these configs at send time, expands the members
 * via entitlements, gathers notes for the resolved producer set, and emails
 * the digest. This component is configuration-only.
 *
 * Data layer is currently in-memory mock state — API + DB land in a follow-up.
 */
@Component({
  selector: 'app-daily-digest',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    DialogComponent,
    DialogHeaderComponent,
    DialogTitleComponent,
    DialogDescriptionComponent,
    DialogFooterComponent,
  ],
  templateUrl: './daily-digest.component.html',
})
export class DailyDigestComponent implements OnInit {
  private readonly apiService = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  // ── Catalogs fetched from /api/entitlements/catalog ─────────────────────
  // Empty until the GET resolves; the picker tabs render "Loading…" until then.
  protected readonly availablePeople = signal<RecapMember[]>([]);
  protected readonly availableTradeUnits = signal<RecapMember[]>([]);
  protected readonly availableTradeUnitGroups = signal<RecapMember[]>([]);
  protected readonly catalogLoading = signal(false);
  protected readonly catalogError = signal<string | null>(null);

  // Lookups for cascade-select: group → its TU codes, person → their TU codes.
  private readonly _groupTuCodes = signal<Map<string, string[]>>(new Map());
  private readonly _personTuCodes = signal<Map<string, string[]>>(new Map());

  ngOnInit(): void {
    this._loadCatalog();
  }

  private _loadCatalog(): void {
    this.catalogLoading.set(true);
    this.catalogError.set(null);
    this.apiService.getEntitlementsCatalog()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (catalog: EntitlementsCatalog) => {
          // Map entitlements shapes onto the picker's RecapMember shape so the
          // dialog can treat all three tabs uniformly.
          this.availablePeople.set(catalog.people.map(p => ({
            id: p.userId,
            name: p.displayName || p.userId,
            type: 'person' as const,
            email: p.email,
          })));
          this.availableTradeUnits.set(catalog.tradeUnits.map(t => ({
            id: t.code,
            name: t.description ? `${t.code} — ${t.description}` : t.code,
            type: 'trade-unit' as const,
          })));
          this.availableTradeUnitGroups.set(catalog.groups.map(g => ({
            id: String(g.groupId),
            name: g.name,
            type: 'trade-unit-group' as const,
          })));
          // Build cascade lookups.
          this._groupTuCodes.set(new Map(catalog.groups.map(g => [String(g.groupId), g.tradeUnitCodes])));
          this._personTuCodes.set(new Map(catalog.people.map(p => [p.userId, p.tradeUnitCodes])));
          this.catalogLoading.set(false);
        },
        error: () => {
          this.catalogError.set('Could not load the entitlements directory. Try again later.');
          this.catalogLoading.set(false);
        },
      });
  }

  // ── Persisted groups (mock — replace with API later) ────────────────────
  protected readonly groups = signal<RecapGroup[]>([
    {
      id: 'RG001',
      name: 'Iowa Territory Daily Recap',
      deliveryMethod: 'email',
      members: [
        { id: 'P001', name: 'David Thompson', type: 'person', email: 'dthompson@company.com' },
        { id: 'TU001', name: 'Iowa Territory', type: 'trade-unit' },
      ],
      ccList: ['lmartinez@company.com', 'manager@company.com'],
      enabled: true,
    },
    {
      id: 'RG002',
      name: 'Executive Summary',
      deliveryMethod: 'teams',
      members: [
        { id: 'TUG003', name: 'Executive Team', type: 'trade-unit-group' },
      ],
      ccList: ['admin@company.com'],
      enabled: true,
    },
  ]);

  // ── Dialog + form state ─────────────────────────────────────────────────
  protected readonly dialogOpen = signal(false);
  protected readonly editingGroupId = signal<string | null>(null);

  protected readonly formName = signal('');
  protected readonly formDeliveryMethod = signal<DeliveryMethod>('email');
  protected readonly formMembers = signal<RecapMember[]>([]);
  protected readonly formCcList = signal<string[]>([]);
  protected readonly newCcEmail = signal('');
  protected readonly memberPickerTab = signal<MemberTab>('people');

  // Tab definitions for the member picker — label includes a live count, mirroring
  // the Usage Dashboard's segmented control.
  protected readonly memberPickerTabs = computed<{ id: MemberTab; label: string }[]>(() => [
    { id: 'people', label: `People (${this.availablePeople().length})` },
    { id: 'trade-units', label: `Trade Units (${this.availableTradeUnits().length})` },
    { id: 'groups', label: `Groups (${this.availableTradeUnitGroups().length})` },
  ]);

  /** Active/inactive pill classes. Track is gray-700 in dark mode (visible against the
   *  dialog's gray-800 body); active pill is gray-600 so it sits a shade lighter than the
   *  track without going dark. */
  protected memberTabClass(id: MemberTab): string {
    return this.memberPickerTab() === id
      ? 'flex-1 text-center px-4 py-2 text-sm font-medium rounded-full transition-all duration-200 bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
      : 'flex-1 text-center px-4 py-2 text-sm font-medium rounded-full transition-all duration-200 bg-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white';
  }

  // Custom dropdown state for delivery method so options can render with icons.
  // Native <select> strips SVG children from <option> elements.
  protected readonly deliveryDropdownOpen = signal(false);
  protected readonly deliveryOptions: { value: DeliveryMethod; label: string }[] = [
    { value: 'email', label: 'Email' },
    { value: 'teams', label: 'Microsoft Teams' },
  ];

  protected toggleDeliveryDropdown(): void {
    this.deliveryDropdownOpen.update(open => !open);
  }

  protected selectDelivery(value: DeliveryMethod): void {
    this.formDeliveryMethod.set(value);
    this.deliveryDropdownOpen.set(false);
  }

  protected readonly isEditing = computed(() => this.editingGroupId() !== null);
  protected readonly canSubmit = computed(() => !!this.formName().trim() && this.formMembers().length > 0);
  protected readonly selectedMemberIds = computed(() => new Set(this.formMembers().map(m => m.id)));

  // ── Cascade selection ───────────────────────────────────────────────────
  // Adding a Group implies all its TUs; adding a Group or TU implies all the
  // people in those TUs. "Added:" only ever shows the explicit members, but the
  // People / Trade Units tabs reflect the implied coverage too.

  /** TU codes covered by the current explicit members (own TUs + group TUs). */
  protected readonly effectiveTuCodes = computed(() => {
    const codes = new Set<string>();
    const groupMap = this._groupTuCodes();
    for (const m of this.formMembers()) {
      if (m.type === 'trade-unit') {
        codes.add(m.id);
      } else if (m.type === 'trade-unit-group') {
        for (const tu of groupMap.get(m.id) ?? []) codes.add(tu);
      }
    }
    return codes;
  });

  /** Person ids covered — explicitly added, or belonging to a covered TU. */
  protected readonly effectivePeopleIds = computed(() => {
    const ids = new Set<string>();
    for (const m of this.formMembers()) {
      if (m.type === 'person') ids.add(m.id);
    }
    const tus = this.effectiveTuCodes();
    if (tus.size > 0) {
      const personMap = this._personTuCodes();
      for (const [personId, personTus] of personMap) {
        if (personTus.some(tu => tus.has(tu))) ids.add(personId);
      }
    }
    return ids;
  });

  /** Row state for the picker: 'explicit' (in Added), 'implied' (selected via a
   *  group/TU but not its own chip), or 'none'. */
  protected memberState(id: string, type: MemberType): 'explicit' | 'implied' | 'none' {
    if (this.selectedMemberIds().has(id)) return 'explicit';
    if (type === 'trade-unit' && this.effectiveTuCodes().has(id)) return 'implied';
    if (type === 'person' && this.effectivePeopleIds().has(id)) return 'implied';
    return 'none';
  }

  // ── Group list actions ──────────────────────────────────────────────────
  protected openCreateDialog(): void {
    this._resetForm();
    this.editingGroupId.set(null);
    this.dialogOpen.set(true);
  }

  protected openEditDialog(group: RecapGroup): void {
    this.formName.set(group.name);
    this.formDeliveryMethod.set(group.deliveryMethod);
    this.formMembers.set([...group.members]);
    this.formCcList.set([...group.ccList]);
    this.newCcEmail.set('');
    this.editingGroupId.set(group.id);
    this.dialogOpen.set(true);
  }

  protected closeDialog(): void {
    this.dialogOpen.set(false);
    this.deliveryDropdownOpen.set(false);
    this.editingGroupId.set(null);
    this._resetForm();
  }

  // ── Delete confirmation ─────────────────────────────────────────────────
  protected readonly deleteDialogOpen = signal(false);
  protected readonly pendingDeleteId = signal<string | null>(null);
  protected readonly pendingDeleteName = computed(() => {
    const id = this.pendingDeleteId();
    return id ? this.groups().find(g => g.id === id)?.name ?? '' : '';
  });

  protected requestDeleteGroup(group: RecapGroup): void {
    this.pendingDeleteId.set(group.id);
    this.deleteDialogOpen.set(true);
  }

  protected cancelDeleteGroup(): void {
    this.deleteDialogOpen.set(false);
    this.pendingDeleteId.set(null);
  }

  protected confirmDeleteGroup(): void {
    const id = this.pendingDeleteId();
    if (id) {
      this.groups.update(list => list.filter(g => g.id !== id));
    }
    this.cancelDeleteGroup();
  }

  protected toggleGroupEnabled(group: RecapGroup): void {
    this.groups.update(list => list.map(g => g.id === group.id ? { ...g, enabled: !g.enabled } : g));
  }

  protected saveGroup(): void {
    if (!this.canSubmit()) return;
    const editingId = this.editingGroupId();
    const payload = {
      name: this.formName().trim(),
      deliveryMethod: this.formDeliveryMethod(),
      members: this.formMembers(),
      ccList: this.formCcList(),
    };
    if (editingId) {
      this.groups.update(list => list.map(g => g.id === editingId ? { ...g, ...payload } : g));
    } else {
      // Stable id for the mock — server-assigned once persistence lands.
      const nextId = `RG${String(this.groups().length + 1).padStart(3, '0')}`;
      this.groups.update(list => [...list, { id: nextId, ...payload, enabled: true }]);
    }
    this.closeDialog();
  }

  // ── Member picker actions ───────────────────────────────────────────────
  protected addMember(member: RecapMember): void {
    if (this.selectedMemberIds().has(member.id)) return;
    this.formMembers.update(list => [...list, member]);
  }

  protected removeMember(memberId: string): void {
    this.formMembers.update(list => list.filter(m => m.id !== memberId));
  }

  // ── CC list actions ─────────────────────────────────────────────────────
  protected addCc(): void {
    const email = this.newCcEmail().trim();
    if (!email || this.formCcList().includes(email)) return;
    this.formCcList.update(list => [...list, email]);
    this.newCcEmail.set('');
  }

  protected removeCc(email: string): void {
    this.formCcList.update(list => list.filter(e => e !== email));
  }

  protected onCcKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.addCc();
  }

  // ── Display helpers ─────────────────────────────────────────────────────
  protected memberTypeLabel(type: MemberType): string {
    switch (type) {
      case 'person': return 'Person';
      case 'trade-unit': return 'Trade Unit';
      case 'trade-unit-group': return 'Trade Unit Group';
    }
  }

  protected deliveryLabel(method: DeliveryMethod): string {
    return method === 'email' ? 'Email' : 'Microsoft Teams';
  }

  protected formMemberCount = computed(() => this.formMembers().length);

  protected isMemberSelected(memberId: string): boolean {
    return this.selectedMemberIds().has(memberId);
  }

  private _resetForm(): void {
    this.formName.set('');
    this.formDeliveryMethod.set('email');
    this.formMembers.set([]);
    this.formCcList.set([]);
    this.newCcEmail.set('');
    this.memberPickerTab.set('people');
  }
}
