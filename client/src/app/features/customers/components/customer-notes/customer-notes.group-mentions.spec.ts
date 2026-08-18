import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { of } from 'rxjs';
import { CustomerNotesComponent } from './customer-notes.component';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { Customer, MentionCatalog, Note } from '@models';

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
        { provide: ApiService, useValue: { getMentionCatalog: () => of(catalog) } },
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
});
