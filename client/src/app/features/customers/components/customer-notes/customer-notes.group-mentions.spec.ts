import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { of } from 'rxjs';
import { CustomerNotesComponent } from './customer-notes.component';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { Customer, MentionCatalog, Note } from '@models';
import { TeamsDirectoryService, GraphTeamsChannel } from '@core/services/teams-directory.service';

/** What Graph reports the signed-in user's own teams contain. "Grain Desk" is already registered
 *  (it is in the catalog below); "Logistics" is not, so picking it has to register it first. */
const graphChannels: GraphTeamsChannel[] = [
  { teamId: 't1', teamName: 'Trading', channelId: 'c-grain', displayName: 'Grain Desk', channelEmail: 'a.scoular.com@amer.teams.ms' },
  { teamId: 't2', teamName: 'Ops', channelId: 'c-logistics', displayName: 'Logistics', channelEmail: 'b.scoular.com@amer.teams.ms' },
];

/**
 * A user's own groups are @-mentionable alongside people and trade units. The picker must keep them
 * distinguishable from the IT-managed trade-unit groups (both used to read "Group"), and the saved
 * note must highlight ONLY what the author typed — the API expands a group into member rows, and
 * those carry `via` precisely so they don't light up names nobody wrote.
 */
const catalog: MentionCatalog = {
  people: [{ userId: 'SFletcher', displayName: 'Sam Fletcher', email: 'SFletcher@scoular.com' }],
  tradeUnits: [{ code: '1084', description: 'Omaha' }],
  tradeUnitGroups: [{ groupId: 12, name: 'Corn Belt' }],
  appGroups: [{ groupId: 7, name: 'Corn Belt', memberCount: 3, isOwner: true }],
  teamsChannels: [{ channelDbId: 21, displayName: 'Grain Desk', teamName: 'Trading', channelId: 'c-grain' }],
};

function makeNote(over: Partial<Note> = {}): Note {
  return {
    id: 1, customerId: 100, customerName: 'Acme', content: 'note',
    isPinned: false, createdBy: 'CEgr', createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  } as Note;
}

describe('CustomerNotesComponent — group mentions', () => {
  let component: CustomerNotesComponent;
  let ref: ComponentRef<CustomerNotesComponent>;
  let fixture: ComponentFixture<CustomerNotesComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ApiService,
          useValue: {
            getMentionCatalog: () => of(catalog),
            registerTeamsChannel: (b: { displayName: string; teamName: string; channelId: string }) =>
              of({ id: 77, displayName: b.displayName, teamName: b.teamName, channelId: b.channelId }),
          },
        },
        {
          provide: TeamsDirectoryService,
          useValue: { getChannels: () => of(graphChannels) },
        },
        { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {} } },
      ],
    });
    TestBed.overrideComponent(CustomerNotesComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    fixture = TestBed.createComponent(CustomerNotesComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    ref.setInput('customer', { id: 100 } as unknown as Customer);
    ref.setInput('notes', []);
    fixture.detectChanges();
  });

  function optionsFor(query: string) {
    component.mentionDropdownOpen.set(true);
    component.mentionQuery.set(query);
    return component.mentionOptions();
  }

  it('offers the user\'s own group, labelled with its member count', () => {
    const group = optionsFor('corn').find(o => o.type === 'app-group');
    expect(group).toBeDefined();
    expect(group!.id).toBe('7');
    expect(group!.secondary).toBe('Group · 3 members');
  });

  it('keeps a personal group and a same-named trade-unit group as distinct options', () => {
    const opts = optionsFor('corn belt');
    expect(opts.filter(o => o.name === 'Corn Belt').map(o => o.type).sort())
      .toEqual(['app-group', 'trade-unit-group']);
    // The old label was "Group" for both, which read identically in one flat list.
    expect(opts.find(o => o.type === 'trade-unit-group')!.secondary).toBe('Trade unit group');
  });

  it('singularizes the member count', () => {
    ref.setInput('notes', []);
    component.mentionCatalog.set({ ...catalog, appGroups: [{ groupId: 8, name: 'Solo', memberCount: 1, isOwner: true }] });
    expect(optionsFor('solo')[0].secondary).toBe('Group · 1 member');
  });

  it('tolerates a catalog with no appGroups (older API, or the groups source unavailable)', () => {
    component.mentionCatalog.set({ people: [], tradeUnits: [], tradeUnitGroups: [{ groupId: 12, name: 'Corn Belt' }] });
    const opts = optionsFor('corn');
    expect(opts.map(o => o.type)).toEqual(['trade-unit-group']);
  });

  it('highlights the group name the author typed, not the expanded members', () => {
    const note = makeNote({
      content: 'Heads up @Corn Belt on the basis move',
      mentions: [
        { type: 'app-group', id: '7', name: 'Corn Belt' },
        // Server-expanded: these are recipients, not text the author wrote.
        { type: 'person', id: 'SFletcher', name: 'Sam Fletcher', via: 'app-group:7' },
        { type: 'trade-unit', id: '1084', name: '1084', via: 'app-group:7' },
      ],
    });

    const segs = component.noteViewSegments(note);
    expect(segs.filter(s => s.kind === 'mention').map(s => s.text)).toEqual(['@Corn Belt']);
  });

  it('does not highlight an expanded member whose name happens to appear in the body', () => {
    const note = makeNote({
      content: 'Called @1084 about Sam Fletcher retiring',
      mentions: [
        { type: 'trade-unit', id: '1084', name: '1084' },
        { type: 'person', id: 'SFletcher', name: 'Sam Fletcher', via: 'app-group:7' },
      ],
    });

    const mentions = component.noteViewSegments(note).filter(s => s.kind === 'mention').map(s => s.text);
    expect(mentions).toEqual(['@1084']);
    expect(mentions).not.toContain('Sam Fletcher');
  });

  // ── Teams groups ─────────────────────────────────────────────────────────
  // A group that delivers to Teams posts the note to its channel instead of emailing members, so the
  // picker labels it by destination. A member count would be actively misleading here: such an
  // entry can have zero members and still notify a whole channel.

  it('labels a Teams group by its destination, not a member count', () => {
    component.mentionCatalog.set({
      ...catalog,
      appGroups: [{ groupId: 9, name: 'Grain Desk', memberCount: 4, isOwner: true, postsToChannel: true }],
    });

    const group = optionsFor('grain').find(o => o.type === 'app-group');

    expect(group!.secondary).toBe('Group · Posts to Teams channel');
    expect(group!.secondary).not.toContain('member');
  });

  it('offers a Teams group that has no members at all', () => {
    component.mentionCatalog.set({
      ...catalog,
      appGroups: [{ groupId: 9, name: 'Grain Desk', memberCount: 0, isOwner: true, postsToChannel: true }],
    });

    const group = optionsFor('grain').find(o => o.type === 'app-group');

    expect(group).toBeDefined();
    expect(group!.id).toBe('9');
  });

  it('still shows a member count for an ordinary group', () => {
    // Regression guard: the new label must key off the destination, not off every app-group.
    component.mentionCatalog.set({
      ...catalog,
      appGroups: [{ groupId: 7, name: 'Corn Belt', memberCount: 3, isOwner: true, postsToChannel: false }],
    });

    expect(optionsFor('corn').find(o => o.type === 'app-group')!.secondary).toBe('Group · 3 members');
  });

  // ── Teams channels by name ───────────────────────────────────────────────
  // Two sources feed these options: channels already registered (usable by anyone) and channels
  // read from the signed-in user's own teams. Merged so one never appears twice, and scoped for
  // free — you only ever see teams you belong to, which is what keeps the list manageable.

  it('offers a registered channel, labelled with its team', () => {
    const opt = optionsFor('grain desk').find(o => o.type === 'teams-channel');

    expect(opt).toBeDefined();
    expect(opt!.id).toBe('21');                       // registry id, not the Graph channel id
    expect(opt!.secondary).toBe('Teams channel · Trading');
  });

  it('shows a registered channel once, not twice, when Graph reports it too', () => {
    const channels = optionsFor('grain desk').filter(o => o.type === 'teams-channel');

    expect(channels).toHaveLength(1);
  });

  it('offers a channel from your teams that nobody has registered yet', () => {
    const opt = optionsFor('logistics').find(o => o.type === 'teams-channel');

    expect(opt).toBeDefined();
    expect(opt!.id).toBe('');                         // no id until picking registers it
    expect(opt!.secondary).toBe('Teams channel · Ops');
  });

  it('never puts a channel address on an option', () => {
    // The note must reference a channel by id only. An address on the option would end up on the
    // note, which is exactly what the server-side design avoids.
    const opts = optionsFor('logistics').filter(o => o.type === 'teams-channel');

    expect(JSON.stringify(opts.map(o => ({ type: o.type, id: o.id, name: o.name, secondary: o.secondary }))))
      .not.toContain('teams.ms');
  });

  it('carries no address on the Teams option, so none can reach the saved note', () => {
    // The note must never record a destination: selectMention copies only type/id/name/email off
    // the option, and the workflow re-reads the channel address from the group at send time. That
    // is what keeps a client-authored address out of the delivery path.
    component.mentionCatalog.set({
      ...catalog,
      appGroups: [{ groupId: 9, name: 'Grain Desk', memberCount: 0, isOwner: true, postsToChannel: true }],
    });

    const group = optionsFor('grain').find(o => o.type === 'app-group')!;

    expect(group.email).toBeUndefined();
    expect(JSON.stringify(group)).not.toContain('teams.ms');
  });
});
