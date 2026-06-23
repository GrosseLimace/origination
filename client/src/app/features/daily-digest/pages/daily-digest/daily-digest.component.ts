import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import {
  DialogComponent,
  DialogHeaderComponent,
  DialogTitleComponent,
  DialogDescriptionComponent,
  DialogFooterComponent,
} from '@shared/components/dialog/dialog.component';
import { DeliveryMethod, MemberType, RecapGroup, RecapGroupSaveRequest, RecapMember } from '@features/daily-digest/models/recap-group.model';
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
 * Persisted via /api/dailyrecapgroups. The user manages the groups they created and
 * additionally sees groups they're a member of, shown faded and read-only.
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
  private readonly toast = inject(ToastService);
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
    this._loadGroups();
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

  // ── Persisted groups (loaded from /api/dailyrecapgroups) ────────────────
  protected readonly groups = signal<RecapGroup[]>([]);
  protected readonly groupsLoading = signal(false);
  protected readonly groupsError = signal<string | null>(null);
  /** Guards the Save button while a create/update request is in flight. */
  protected readonly saving = signal(false);

  private _loadGroups(): void {
    this.groupsLoading.set(true);
    this.groupsError.set(null);
    this.apiService.getRecapGroups()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: groups => {
          this.groups.set(groups);
          this.groupsLoading.set(false);
        },
        error: () => {
          this.groupsError.set('Could not load your recap groups. Try again later.');
          this.groupsLoading.set(false);
        },
      });
  }

  // ── Dialog + form state ─────────────────────────────────────────────────
  protected readonly dialogOpen = signal(false);
  protected readonly editingGroupId = signal<string | null>(null);

  protected readonly formName = signal('');
  protected readonly formDeliveryMethod = signal<DeliveryMethod>('email');
  protected readonly formMembers = signal<RecapMember[]>([]);
  protected readonly formCcList = signal<string[]>([]);
  protected readonly newCcEmail = signal('');
  // Microsoft Teams channel email — only used/required when deliveryMethod is 'teams'.
  protected readonly formTeamsEmail = signal('');
  protected readonly memberPickerTab = signal<MemberTab>('people');
  // Free-text filter for the member picker — applies to the active tab's list.
  protected readonly memberSearch = signal('');

  /** Switches the picker tab and clears the search so each tab starts fresh. */
  protected setMemberTab(tab: MemberTab): void {
    this.memberPickerTab.set(tab);
    this.memberSearch.set('');
  }

  /** People matching the search term (name / email / UPN). */
  protected readonly filteredPeople = computed(() => {
    const q = this.memberSearch().trim().toLowerCase();
    const list = this.availablePeople();
    if (!q) return list;
    return list.filter(p =>
      p.name.toLowerCase().includes(q)
      || (p.email?.toLowerCase().includes(q) ?? false)
      || p.id.toLowerCase().includes(q));
  });

  /** Trade units matching the search term (code + description live in `name`). */
  protected readonly filteredTradeUnits = computed(() => {
    const q = this.memberSearch().trim().toLowerCase();
    const list = this.availableTradeUnits();
    if (!q) return list;
    return list.filter(t => t.name.toLowerCase().includes(q));
  });

  /** Trade-unit groups matching the search term. */
  protected readonly filteredTradeUnitGroups = computed(() => {
    const q = this.memberSearch().trim().toLowerCase();
    const list = this.availableTradeUnitGroups();
    if (!q) return list;
    return list.filter(g => g.name.toLowerCase().includes(q));
  });

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
  protected readonly canSubmit = computed(() =>
    !!this.formName().trim()
    && this.formMembers().length > 0
    // Teams delivery requires a valid channel email so the recap has a destination.
    && (this.formDeliveryMethod() !== 'teams' || this._isValidEmail(this.formTeamsEmail()))
  );

  /** Minimal email check — there's no shared validator in this feature (CC list relies on
   *  the input's type="email" only). Kept local + simple for the Teams channel email. */
  private _isValidEmail(value: string): boolean {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
  }
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
    if (!group.isOwner) return;   // member-only groups are read-only
    this.formName.set(group.name);
    this.formDeliveryMethod.set(group.deliveryMethod);
    this.formMembers.set([...group.members]);
    this.formCcList.set([...group.ccList]);
    this.newCcEmail.set('');
    this.formTeamsEmail.set(group.teamsChannelEmail ?? '');
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
    if (!group.isOwner) return;   // member-only groups are read-only
    this.pendingDeleteId.set(group.id);
    this.deleteDialogOpen.set(true);
  }

  protected cancelDeleteGroup(): void {
    this.deleteDialogOpen.set(false);
    this.pendingDeleteId.set(null);
  }

  protected confirmDeleteGroup(): void {
    const id = this.pendingDeleteId();
    if (!id) {
      this.cancelDeleteGroup();
      return;
    }
    this.apiService.deleteRecapGroup(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.groups.update(list => list.filter(g => g.id !== id));
          this.toast.success('Recap group deleted.');
        },
        error: () => this.toast.error('Could not delete the recap group. Try again.'),
      });
    this.cancelDeleteGroup();
  }

  protected toggleGroupEnabled(group: RecapGroup): void {
    if (!group.isOwner) return;   // member-only groups are read-only
    const next = !group.enabled;
    // Optimistic flip; revert on failure.
    this.groups.update(list => list.map(g => g.id === group.id ? { ...g, enabled: next } : g));
    this.apiService.setRecapGroupEnabled(group.id, next)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: updated => this.groups.update(list => list.map(g => g.id === updated.id ? updated : g)),
        error: () => {
          this.groups.update(list => list.map(g => g.id === group.id ? { ...g, enabled: group.enabled } : g));
          this.toast.error('Could not update the recap group. Try again.');
        },
      });
  }

  protected saveGroup(): void {
    if (!this.canSubmit() || this.saving()) return;
    // Flush any CC address typed but not yet committed with Enter / the Add button,
    // so a user who types an address and clicks Save directly doesn't lose it. If that pending
    // text is an invalid email, addCc() surfaces the error and leaves it in the box — abort the
    // save rather than silently dropping it.
    this.addCc();
    if (this.newCcEmail().trim()) return;
    const editingId = this.editingGroupId();
    const request: RecapGroupSaveRequest = {
      name: this.formName().trim(),
      deliveryMethod: this.formDeliveryMethod(),
      members: this.formMembers(),
      ccList: this.formCcList(),
      // Only persist the Teams email for Teams groups; clear it if the method is Email.
      teamsChannelEmail: this.formDeliveryMethod() === 'teams' ? this.formTeamsEmail().trim() : undefined,
    };
    this.saving.set(true);
    const request$ = editingId
      ? this.apiService.updateRecapGroup(editingId, request)
      : this.apiService.createRecapGroup(request);
    request$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: saved => {
          this.groups.update(list =>
            editingId
              ? list.map(g => g.id === saved.id ? saved : g)
              : [...list, saved]);
          this.saving.set(false);
          this.toast.success(editingId ? 'Recap group updated.' : 'Recap group created.');
          this.closeDialog();
        },
        error: () => {
          this.saving.set(false);
          this.toast.error('Could not save the recap group. Try again.');
        },
      });
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
    if (!email) return;
    if (!this._isValidEmail(email)) {
      // type="email" only guards typing in the field; the Enter key and the Save flush call
      // addCc() programmatically, so validate the format here too. Keep the text so the user can fix it.
      this.toast.error('Enter a valid email address.');
      return;
    }
    if (!this.formCcList().includes(email)) {
      this.formCcList.update(list => [...list, email]);
    }
    this.newCcEmail.set(''); // added or duplicate → clear the input
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
    this.formTeamsEmail.set('');
    this.memberPickerTab.set('people');
    this.memberSearch.set('');
  }
}
