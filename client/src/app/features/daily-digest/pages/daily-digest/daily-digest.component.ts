import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MsalService } from '@azure/msal-angular';
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
 * Persisted via /api/dailyrecapgroups. Edit rights equal visibility: the page lists the groups the
 * user created plus ones they are a member of, and all of them are editable. Only DELETE is
 * creator-only.
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
  private readonly msalService = inject(MsalService);
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
          this.groupsError.set('Could not load your groups. Try again later.');
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
  /** Route @-mentions of this entry to the Teams channel instead of emailing its members. Only
   *  meaningful with Teams delivery; selectDelivery() clears it when the method goes back to Email. */
  protected readonly formMentionsToChannel = signal(false);
  /** Daily-recap opt-in, honoured on CREATE only (after that the card toggle owns it). Defaults to
   *  false so a group made purely to @-mention doesn't quietly start emailing everyone in it. */
  protected readonly formEnabled = signal(false);
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
    // Channel routing has no meaning without a channel, and leaving it set would let a form that
    // looks like plain email delivery save a flag the server then rejects.
    if (value !== 'teams') this.formMentionsToChannel.set(false);
    this.deliveryDropdownOpen.set(false);
  }

  /** True when this entry delivers @-mentions to its Teams channel — the shape that makes members
   *  optional and the daily recap unavailable. */
  protected readonly isChannelRouted = computed(() =>
    this.formDeliveryMethod() === 'teams' && this.formMentionsToChannel());

  /** The daily recap is built from the notes the MEMBERS can see, so a memberless entry cannot
   *  send one. Mirrors the server rule rather than letting the user submit and get a 400. */
  protected readonly canEnableRecap = computed(() => this.formMembers().length > 0);

  protected readonly isEditing = computed(() => this.editingGroupId() !== null);
  protected readonly canSubmit = computed(() =>
    !!this.formName().trim()
    // Members are optional ONLY for a channel-routed entry, where the channel is the recipient.
    && (this.formMembers().length > 0 || this.isChannelRouted())
    // A group with nobody in it has no notes to recap, so the two can't both be on.
    && !(this.formEnabled() && this.formMembers().length === 0)
    // Teams delivery requires a valid channel address (a *.teams.ms "send to channel" email) so the
    // recap has a destination — the backend rejects anything else and the workflow fails closed.
    && (this.formDeliveryMethod() !== 'teams' || this._isTeamsChannel(this.formTeamsEmail()))
  );

  /** Minimal email check — there's no shared validator in this feature (CC list relies on
   *  the input's type="email" only). Kept local + simple for the Teams channel email. */
  private _isValidEmail(value: string): boolean {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
  }

  /** CC addresses are confined to @scoular.com so a recap can't be forwarded externally
   *  (mirrors the API's EmailList domain rule). */
  private _isScoularEmail(value: string): boolean {
    return this._isValidEmail(value) && value.trim().toLowerCase().endsWith('@scoular.com');
  }

  /** A Scoular Teams "send to channel" address: a valid email on a *.teams.ms host whose local part
   *  ends in .scoular.com (mirrors the API rule). The *.teams.ms host is shared across all tenants, so
   *  the local-part domain is what keeps the destination inside Scoular and blocks cross-tenant sends. */
  private _isTeamsChannel(value: string): boolean {
    const v = value.trim().toLowerCase();
    if (!this._isValidEmail(v) || !v.endsWith('.teams.ms')) return false;
    const at = v.lastIndexOf('@');
    return at > 0 && v.slice(0, at).endsWith('.scoular.com');
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
    if (!group.canEdit) return;   // server owns the policy; today every visible group is editable
    this.formName.set(group.name);
    this.formDeliveryMethod.set(group.deliveryMethod);
    this.formMembers.set([...group.members]);
    this.formCcList.set([...group.ccList]);
    this.newCcEmail.set('');
    this.formTeamsEmail.set(group.teamsChannelEmail ?? '');
    this.formMentionsToChannel.set(group.mentionsToChannel);
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
    if (!group.isOwner) return;   // deleting a group stays creator-only
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
          this.toast.success('Group deleted.');
        },
        error: () => this.toast.error('Could not delete the group. Try again.'),
      });
    this.cancelDeleteGroup();
  }

  /** A memberless entry (only possible when it routes @-mentions to a channel) has no members whose
   *  notes the recap would summarise, so the recap can't be turned on. Turning it OFF stays allowed
   *  so an entry that somehow got into that state is always recoverable. */
  protected canToggleRecap(group: RecapGroup): boolean {
    return group.canEdit && (group.enabled || group.members.length > 0);
  }

  protected toggleGroupEnabled(group: RecapGroup): void {
    if (!this.canToggleRecap(group)) return;   // any member may start or stop the daily recap
    const next = !group.enabled;
    // Optimistic flip; revert on failure.
    this.groups.update(list => list.map(g => g.id === group.id ? { ...g, enabled: next } : g));
    this.apiService.setRecapGroupEnabled(group.id, next)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: updated => this.groups.update(list => list.map(g => g.id === updated.id ? updated : g)),
        error: () => {
          this.groups.update(list => list.map(g => g.id === group.id ? { ...g, enabled: group.enabled } : g));
          this.toast.error('Could not update the group. Try again.');
        },
      });
  }

  // ── Self-removal confirmation ───────────────────────────────────────────
  // Any member can edit a group, which includes removing the very member row that grants them
  // access. That's allowed — leaving a group is legitimate — but it shouldn't be a surprise, so a
  // save that would drop the caller's own access asks first.
  protected readonly selfRemovalDialogOpen = signal(false);

  /** The caller's UPN prefix, matching a `person` member's id. */
  private _callerShortName(): string {
    const account = this.msalService.instance.getActiveAccount()
      ?? this.msalService.instance.getAllAccounts()[0]
      ?? null;
    const username = account?.username ?? '';
    return (username.includes('@') ? username.split('@')[0] : username).toLowerCase();
  }

  /** Whether the given member set still grants the caller access to the group. The catalog the
   *  picker already loaded IS the caller's own scope — its `tradeUnits` are the trade units the
   *  caller is entitled to and its `groups` are the groups the caller belongs to — so no extra
   *  request is needed. */
  private _retainsAccess(members: RecapMember[]): boolean {
    const me = this._callerShortName();
    const myTuCodes = new Set(this.availableTradeUnits().map(t => t.id.toLowerCase()));
    const myGroupIds = new Set(this.availableTradeUnitGroups().map(g => g.id.toLowerCase()));
    return members.some(m => {
      const id = m.id.toLowerCase();
      if (m.type === 'person') return !!me && id === me;
      if (m.type === 'trade-unit') return myTuCodes.has(id);
      return myGroupIds.has(id);
    });
  }

  /** True when saving the open form would lock the caller out of the group they're editing. The
   *  creator is never at risk — their access comes from CreatedBy, not from a member row. */
  private _wouldRemoveOwnAccess(): boolean {
    const editingId = this.editingGroupId();
    if (!editingId) return false;
    const group = this.groups().find(g => g.id === editingId);
    if (!group || group.isOwner) return false;
    return this._retainsAccess(group.members) && !this._retainsAccess(this.formMembers());
  }

  protected cancelSelfRemoval(): void {
    this.selfRemovalDialogOpen.set(false);
  }

  protected confirmSelfRemoval(): void {
    this.selfRemovalDialogOpen.set(false);
    this._performSave();
  }

  protected saveGroup(): void {
    if (!this.canSubmit() || this.saving()) return;
    // Flush any CC address typed but not yet committed with Enter / the Add button,
    // so a user who types an address and clicks Save directly doesn't lose it. If that pending
    // text is an invalid email, addCc() surfaces the error and leaves it in the box — abort the
    // save rather than silently dropping it.
    this.addCc();
    if (this.newCcEmail().trim()) return;
    if (this._wouldRemoveOwnAccess()) {
      this.selfRemovalDialogOpen.set(true);
      return;
    }
    this._performSave();
  }

  private _performSave(): void {
    const editingId = this.editingGroupId();
    // Computed before the request, while the form and the cached group still hold the pre-save
    // state: a group the caller just removed themselves from is no longer theirs to list, so drop
    // it rather than replacing it with a card the next refresh would take away anyway.
    const leaving = this._wouldRemoveOwnAccess();
    const request: RecapGroupSaveRequest = {
      name: this.formName().trim(),
      deliveryMethod: this.formDeliveryMethod(),
      members: this.formMembers(),
      ccList: this.formCcList(),
      // Only persist the Teams email for Teams groups; clear it if the method is Email.
      teamsChannelEmail: this.formDeliveryMethod() === 'teams' ? this.formTeamsEmail().trim() : undefined,
      mentionsToChannel: this.isChannelRouted(),
      // Create-only — the API ignores this on update, where the card's toggle is the source of truth.
      enabled: this.formEnabled(),
    };
    this.saving.set(true);
    const request$ = editingId
      ? this.apiService.updateRecapGroup(editingId, request)
      : this.apiService.createRecapGroup(request);
    request$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: saved => {
          this.groups.update(list => {
            if (!editingId) return [...list, saved];
            if (leaving) return list.filter(g => g.id !== saved.id);
            return list.map(g => g.id === saved.id ? saved : g);
          });
          this.saving.set(false);
          this.toast.success(
            !editingId ? 'Group created.'
              : leaving ? `You're no longer a member of ${saved.name}.`
                : 'Group updated.');
          this.closeDialog();
        },
        error: () => {
          this.saving.set(false);
          this.toast.error('Could not save the group. Try again.');
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
    if (!this._isScoularEmail(email)) {
      // CC is limited to @scoular.com — a recap can't be forwarded to an external mailbox.
      this.toast.error('CC addresses must be @scoular.com.');
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
    this.formMentionsToChannel.set(false);
    this.formEnabled.set(false);
    this.memberPickerTab.set('people');
    this.memberSearch.set('');
  }
}
