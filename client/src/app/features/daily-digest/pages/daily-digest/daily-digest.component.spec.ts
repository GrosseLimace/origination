import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MsalService } from '@azure/msal-angular';
import { of } from 'rxjs';

import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { RecapGroup, RecapMember } from '@features/daily-digest/models/recap-group.model';

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
  return {
    calls,
    getEntitlementsCatalog: () => of(CATALOG),
    getRecapGroups: () => of(initial),
    updateRecapGroup: (id: string, body: Partial<RecapGroup>) => {
      count('update');
      return of(group({ ...body, id }));
    },
    createRecapGroup: () => { count('create'); return of(group()); },
    setRecapGroupEnabled: (id: string, enabled: boolean) => {
      count('setEnabled');
      return of(group({ id, enabled }));
    },
    deleteRecapGroup: () => { count('delete'); return of(void 0); },
  };
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
});
