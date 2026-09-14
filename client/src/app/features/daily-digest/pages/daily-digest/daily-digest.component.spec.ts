import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MsalService } from '@azure/msal-angular';
import { of } from 'rxjs';

import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { RecapGroup, RecapGroupSaveRequest, RecapMember } from '@features/daily-digest/models/recap-group.model';

import { DailyDigestComponent } from './daily-digest.component';

/**
 * Guards the shared-editing rules on Manage Groups. Any member of a group can edit it — the server
 * says so via `canEdit` — while DELETE stays with the creator (`isOwner`). Conflating the two would
 * render a Delete button that 403s on click.
 *
 * Also covers the self-removal warning: editing yourself out of a group you did not create is
 * allowed, but it costs you your own access, so it has to be confirmed first.
 */

const CALLER = 'mgr@scoular.com';

/** What the picker catalog returns: the caller is entitled to TU1 and belongs to group 7. */
const CATALOG = {
  people: [{ userId: 'mgr', displayName: 'Manager', email: CALLER, tradeUnitCodes: ['TU1'] }],
  tradeUnits: [{ code: 'TU1', description: 'Trade Unit One' }],
  groups: [{ groupId: 7, name: 'My Group', tradeUnitCodes: ['TU1'] }],
};

/** The component members these tests drive. `protected` is compile-time only, so one cast in
 *  build() is enough and keeps every test readable. */
interface Internals {
  groups: () => RecapGroup[];
  dialogOpen: () => boolean;
  editingGroupId: () => string | null;
  deleteDialogOpen: () => boolean;
  selfRemovalDialogOpen: () => boolean;
  formMembers: { (): RecapMember[]; set(value: RecapMember[]): void };
  formName: { (): string; set(value: string): void };
  formTeamsEmail: { (): string; set(value: string): void };
  formEnabled: { (): boolean; set(value: boolean): void };
  formMentionsToChannel: { (): boolean; set(value: boolean): void };
  selectDelivery(value: 'email' | 'teams'): void;
  isChannelRouted: () => boolean;
  canEnableRecap: () => boolean;
  canSubmit: () => boolean;
  canToggleRecap(group: RecapGroup): boolean;
  openCreateDialog(): void;
  openEditDialog(group: RecapGroup): void;
  requestDeleteGroup(group: RecapGroup): void;
  toggleGroupEnabled(group: RecapGroup): void;
  saveGroup(): void;
  confirmSelfRemoval(): void;
  cancelSelfRemoval(): void;
}

function member(type: RecapMember['type'], id: string): RecapMember {
  return { type, id, name: id };
}

/** A group created by someone else that the caller sees as a person member — the interesting case. */
function group(overrides: Partial<RecapGroup> = {}): RecapGroup {
  return {
    id: '5',
    name: 'Daily',
    deliveryMethod: 'email',
    members: [member('person', 'mgr')],
    ccList: [],
    mentionsToChannel: false,
    enabled: true,
    isOwner: false,
    canEdit: true,
    createdBy: 'alice@scoular.com',
    ...overrides,
  };
}

function makeApiStub(initial: RecapGroup[]) {
  const calls: Record<string, number> = {};
  const count = (name: string) => { calls[name] = (calls[name] ?? 0) + 1; };
  const stub = {
    calls,
    /** The body of the most recent createRecapGroup call, so a test can assert the payload. */
    lastCreate: undefined as RecapGroupSaveRequest | undefined,
    getEntitlementsCatalog: () => of(CATALOG),
    getRecapGroups: () => of(initial),
    updateRecapGroup: (id: string, body: Partial<RecapGroup>) => {
      count('update');
      return of(group({ ...body, id }));
    },
    createRecapGroup: (body: RecapGroupSaveRequest) => {
      count('create');
      stub.lastCreate = body;
      return of(group());
    },
    setRecapGroupEnabled: (id: string, enabled: boolean) => {
      count('setEnabled');
      return of(group({ id, enabled }));
    },
    deleteRecapGroup: () => { count('delete'); return of(void 0); },
  };
  return stub;
}

describe('DailyDigestComponent — shared editing', () => {
  let api: ReturnType<typeof makeApiStub>;

  function build(initial: RecapGroup[]): Internals {
    api = makeApiStub(initial);
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { show: () => {}, error: () => {}, success: () => {} } },
        {
          provide: MsalService,
          useValue: {
            instance: {
              getActiveAccount: () => ({ username: CALLER }),
              getAllAccounts: () => [],
            },
          },
        },
      ],
    });
    // happy-dom + JIT can't fetch templateUrl; these tests exercise the component's logic.
    TestBed.overrideComponent(DailyDigestComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    const fixture = TestBed.createComponent(DailyDigestComponent);
    fixture.detectChanges();
    return fixture.componentInstance as unknown as Internals;
  }

  /** Opens the first group for editing, replaces its member list, and saves. */
  function editMembersAndSave(c: Internals, members: RecapMember[]): void {
    c.openEditDialog(c.groups()[0]);
    c.formMembers.set(members);
    c.saveGroup();
  }

  beforeEach(() => TestBed.resetTestingModule());

  // ── canEdit gates editing, isOwner gates deleting ──────────────────────────
  it('opens the edit dialog for a group the caller only belongs to', () => {
    const c = build([group()]);

    c.openEditDialog(c.groups()[0]);

    expect(c.dialogOpen()).toBe(true);
    expect(c.editingGroupId()).toBe('5');
  });

  it('refuses to open the edit dialog when the server says canEdit is false', () => {
    const c = build([group({ canEdit: false })]);

    c.openEditDialog(c.groups()[0]);

    expect(c.dialogOpen()).toBe(false);
  });

  it('lets a non-creator member toggle the daily recap', () => {
    const c = build([group()]);

    c.toggleGroupEnabled(c.groups()[0]);

    expect(api.calls['setEnabled']).toBe(1);
  });

  it('does not offer delete to a member who did not create the group', () => {
    const c = build([group()]);

    c.requestDeleteGroup(c.groups()[0]);

    expect(c.deleteDialogOpen()).toBe(false);
  });

  it('offers delete to the creator', () => {
    const c = build([group({ isOwner: true, createdBy: CALLER })]);

    c.requestDeleteGroup(c.groups()[0]);

    expect(c.deleteDialogOpen()).toBe(true);
  });

  // ── Self-removal warning ───────────────────────────────────────────────────
  it('asks before a save that removes the caller from a group they did not create', () => {
    const c = build([group({ members: [member('person', 'mgr'), member('person', 'sam')] })]);

    editMembersAndSave(c, [member('person', 'sam')]);

    expect(c.selfRemovalDialogOpen()).toBe(true);
    expect(api.calls['update']).toBeUndefined();   // nothing saved yet
  });

  it('saves and drops the group from the list once self-removal is confirmed', () => {
    const c = build([group({ members: [member('person', 'mgr'), member('person', 'sam')] })]);
    editMembersAndSave(c, [member('person', 'sam')]);

    c.confirmSelfRemoval();

    expect(api.calls['update']).toBe(1);
    expect(c.groups()).toEqual([]);
  });

  it('cancelling self-removal saves nothing and leaves the form open', () => {
    const c = build([group({ members: [member('person', 'mgr'), member('person', 'sam')] })]);
    editMembersAndSave(c, [member('person', 'sam')]);

    c.cancelSelfRemoval();

    expect(c.selfRemovalDialogOpen()).toBe(false);
    expect(api.calls['update']).toBeUndefined();
    expect(c.dialogOpen()).toBe(true);
  });

  it('does not warn the creator — their access comes from CreatedBy, not a member row', () => {
    const c = build([group({
      isOwner: true,
      createdBy: CALLER,
      members: [member('person', 'mgr'), member('person', 'sam')],
    })]);

    editMembersAndSave(c, [member('person', 'sam')]);

    expect(c.selfRemovalDialogOpen()).toBe(false);
    expect(api.calls['update']).toBe(1);
  });

  it('does not warn when access is retained through a trade unit the caller is in', () => {
    const c = build([group()]);

    // Drops the person row but adds TU1, which the caller is entitled to.
    editMembersAndSave(c, [member('trade-unit', 'TU1')]);

    expect(c.selfRemovalDialogOpen()).toBe(false);
    expect(api.calls['update']).toBe(1);
  });

  it('does not warn when access is retained through a trade-unit group the caller belongs to', () => {
    const c = build([group()]);

    editMembersAndSave(c, [member('trade-unit-group', '7')]);

    expect(c.selfRemovalDialogOpen()).toBe(false);
    expect(api.calls['update']).toBe(1);
  });

  it('does not warn when the caller had no member row to lose', () => {
    // Visible for some other reason: removing rows that were never the caller's grant shouldn't
    // warn about access they never held that way.
    const c = build([group({ members: [member('person', 'sam'), member('trade-unit', 'TU9')] })]);

    editMembersAndSave(c, [member('person', 'sam')]);

    expect(c.selfRemovalDialogOpen()).toBe(false);
    expect(api.calls['update']).toBe(1);
  });

  // ── @-mentions routed to a Teams channel ──────────────────────────────────
  // A channel entry is a recipient in its own right, so it may have no members — which in turn
  // means it has nobody whose notes a daily recap could summarise.

  const CHANNEL = 'abcd1234.scoular.com@amer.teams.ms';

  /** A new channel-routed entry with no members — the shape the feature exists to allow. */
  function fillChannelForm(c: Internals): void {
    c.openCreateDialog();
    c.formName.set('Grain Desk');
    c.selectDelivery('teams');
    c.formTeamsEmail.set(CHANNEL);
    c.formMentionsToChannel.set(true);
    c.formMembers.set([]);
  }

  it('lets a channel-routed entry be saved with no members', () => {
    const c = build([]);

    fillChannelForm(c);

    expect(c.isChannelRouted()).toBe(true);
    expect(c.canSubmit()).toBe(true);
  });

  it('still requires members when the entry is not channel-routed', () => {
    const c = build([]);
    c.openCreateDialog();
    c.formName.set('Grain Desk');
    c.selectDelivery('teams');
    c.formTeamsEmail.set(CHANNEL);
    c.formMentionsToChannel.set(false);
    c.formMembers.set([]);

    expect(c.canSubmit()).toBe(false);
  });

  it('clears channel routing when delivery switches back to email', () => {
    // Otherwise a form that looks like plain email delivery would post a flag the server rejects.
    const c = build([]);
    fillChannelForm(c);

    c.selectDelivery('email');

    expect(c.formMentionsToChannel()).toBe(false);
    expect(c.isChannelRouted()).toBe(false);
  });

  it('sends mentionsToChannel on the save payload', () => {
    const c = build([]);
    fillChannelForm(c);

    c.saveGroup();

    expect(api.calls['create']).toBe(1);
    expect(api.lastCreate?.mentionsToChannel).toBe(true);
    expect(api.lastCreate?.teamsChannelEmail).toBe(CHANNEL);
  });

  it('blocks the daily recap on a memberless entry', () => {
    const c = build([]);
    fillChannelForm(c);

    expect(c.canEnableRecap()).toBe(false);

    // ...and if the flag were set anyway, the form refuses to submit rather than 400ing.
    c.formEnabled.set(true);
    expect(c.canSubmit()).toBe(false);
  });

  it('allows the daily recap again once the entry has a member', () => {
    const c = build([]);
    fillChannelForm(c);

    c.formMembers.set([member('person', 'sam')]);

    expect(c.canEnableRecap()).toBe(true);
  });

  it('will not turn a memberless group\'s recap on from the card, but will turn one off', () => {
    const c = build([
      group({ id: '5', members: [], enabled: false, mentionsToChannel: true }),
      group({ id: '6', members: [], enabled: true, mentionsToChannel: true }),
    ]);

    // Off -> on is refused: there are no members whose notes it would summarise.
    expect(c.canToggleRecap(c.groups()[0])).toBe(false);
    c.toggleGroupEnabled(c.groups()[0]);
    expect(api.calls['setEnabled']).toBeUndefined();

    // On -> off stays available, so a bad state is always recoverable.
    expect(c.canToggleRecap(c.groups()[1])).toBe(true);
  });

  it('loads mentionsToChannel into the form when editing', () => {
    const c = build([group({ deliveryMethod: 'teams', teamsChannelEmail: CHANNEL, mentionsToChannel: true })]);

    c.openEditDialog(c.groups()[0]);

    expect(c.formMentionsToChannel()).toBe(true);
    expect(c.isChannelRouted()).toBe(true);
  });
});
