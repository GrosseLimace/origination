import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { of } from 'rxjs';
import { CustomerNotesComponent } from './customer-notes.component';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { Customer, MentionCatalog, Note, NoteMention } from '@models';
import { TeamsDirectoryService } from '../../data-access/teams-directory.service';
import { SelectedProducerEngagementFake, provideSelectedProducerEngagement, selectedProducerEngagementFake } from '@testing/selected-producer-engagement.fake';
import { producerProfile, producerProfilesFake, provideProducerProfiles } from '@testing/producer-profiles.fake';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { permissionStub, providePermissions } from '@testing/permission.stub';
import { PermissionId } from '@core/access/permission-ids.generated';

// Covers the note search filter (content + author + created/modified date, ALL typed words required)
// and the combined view segmentation (@mention = green text, search match = green highlight).

function makeCustomer(id: number): Customer {
  return { id } as unknown as Customer;
}

function makeNote(over: Partial<Note> = {}): Note {
  return {
    id: 1,
    customerId: 100,
    customerName: 'Acme',
    content: 'note',
    isPinned: false,
    createdBy: 'CEgr',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  } as Note;
}

/** The page's notes for the producer, which the card reads; set by each test. */
let engagement: SelectedProducerEngagementFake;

describe('CustomerNotesComponent — note search filter + highlight', () => {
  let component: CustomerNotesComponent;
  let ref: ComponentRef<CustomerNotesComponent>;
  let fixture: ComponentFixture<CustomerNotesComponent>;

  // Every producer's saved details, which give a note's bin-site names.
  const profiles = producerProfilesFake();

  const notes: Note[] = [
    makeNote({ id: 1, customerId: 100, content: 'Talked about corn pricing', createdAt: new Date('2026-01-03') }),
    makeNote({ id: 2, customerId: 100, content: 'Soybean delivery scheduled', createdAt: new Date('2026-01-02') }),
    makeNote({ id: 3, customerId: 200, content: 'Wheat basis question', createdAt: new Date('2026-01-01') }),
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { getMentionCatalog: () => of({ people: [], tradeUnits: [], tradeUnitGroups: [], appGroups: [], teamsChannels: [] }) } },
        // The component injects this to offer Teams channels; the real one needs MSAL, which these
        // tests have no reason to stand up.
        { provide: TeamsDirectoryService, useValue: { getChannels: () => of([]) } },
        { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {} } },
        provideSelectedProducerEngagement(engagement = selectedProducerEngagementFake()),
        SelectedCustomerContext,
        provideProducerProfiles(profiles),
      ],
    });
    // happy-dom + JIT can't fetch templateUrl; blank the template — the filter/segment logic is class-level.
    TestBed.overrideComponent(CustomerNotesComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    fixture = TestBed.createComponent(CustomerNotesComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    ref.setInput('customer', makeCustomer(100));
    engagement.notes.set(notes);
    fixture.detectChanges(); // run effects → populate sortedNotesCache from the notes input
  });

  it('shows all notes when the search is empty', () => {
    expect(component.displayedNotes().map(n => n.id).sort()).toEqual([1, 2, 3]);
  });

  it('filters by note content, case-insensitive', () => {
    component.noteSearch.set('CORN');
    expect(component.displayedNotes().map(n => n.id)).toEqual([1]);
  });

  it('requires ALL typed words (AND)', () => {
    component.noteSearch.set('corn pricing'); // note 1 contains both words
    expect(component.displayedNotes().map(n => n.id)).toEqual([1]);
    component.noteSearch.set('corn soybean'); // no single note has both
    expect(component.displayedNotes()).toHaveLength(0);
  });

  it('matches on author (created by) and modified by', () => {
    engagement.notes.set([
      makeNote({ id: 10, customerId: 100, content: 'x', createdBy: 'Jane Rancher' }),
      makeNote({ id: 11, customerId: 100, content: 'y', createdBy: 'A', modifiedBy: 'Carla Editor' }),
    ]);
    fixture.detectChanges();
    component.noteSearch.set('jane');
    expect(component.displayedNotes().map(n => n.id)).toEqual([10]);
    component.noteSearch.set('carla');
    expect(component.displayedNotes().map(n => n.id)).toEqual([11]);
  });

  it('narrows a full date query to that day (AND across the date words)', () => {
    // Noon UTC avoids a date rollover regardless of the test machine's timezone.
    engagement.notes.set([
      makeNote({ id: 30, customerId: 100, content: 'a', createdAt: new Date('2026-06-17T12:00:00Z') }),
      makeNote({ id: 31, customerId: 100, content: 'b', createdAt: new Date('2026-06-05T12:00:00Z') }),
      makeNote({ id: 32, customerId: 100, content: 'c', createdAt: new Date('2026-07-17T12:00:00Z') }),
    ]);
    fixture.detectChanges();
    component.noteSearch.set('Jun 17, 2026');
    expect(component.displayedNotes().map(n => n.id)).toEqual([30]);
  });

  it('composes with the producer filter', () => {
    component.filterValue.set('100');   // only customer 100's notes
    component.noteSearch.set('wheat');  // note 3 matches 'wheat' but is customer 200 → excluded by producer filter
    expect(component.displayedNotes()).toHaveLength(0);
    component.filterValue.set('');      // all producers → the wheat note shows
    expect(component.displayedNotes().map(n => n.id)).toEqual([3]);
  });

  it('clears the search when the selected customer changes', () => {
    component.noteSearch.set('corn');
    expect(component.displayedNotes().map(n => n.id)).toEqual([1]);
    ref.setInput('customer', makeCustomer(200));
    fixture.detectChanges();
    expect(component.noteSearch()).toBe('');
    expect(component.displayedNotes().map(n => n.id).sort()).toEqual([1, 2, 3]);
  });

  it('noteViewSegments highlights search matches (kind=search) and preserves the full text', () => {
    component.noteSearch.set('wheat');
    const segs = component.noteViewSegments(makeNote({ content: 'Sold Wheat to the co-op' }));
    expect(segs.filter(s => s.kind === 'search').map(s => s.text)).toEqual(['Wheat']); // original case kept
    expect(segs.map(s => s.text).join('')).toBe('Sold Wheat to the co-op');            // nothing lost
  });

  // The producer's bin sites are their saved details, not part of the customer.
  it("noteViewSegments marks the names of the producer's bin sites, from their saved details, as kind=bin", () => {
    const note = makeNote({ customerId: 100, content: 'Hauled to North Bins today' });
    expect(component.noteViewSegments(note).some(s => s.kind === 'bin')).toBe(false);

    profiles.set([producerProfile(100, { binSites: [{ name: 'North Bins' }] })]);

    expect(component.noteViewSegments(note).filter(s => s.kind === 'bin').map(s => s.text)).toEqual(['North Bins']);
  });

  it('noteViewSegments marks @mentions as kind=mention', () => {
    component.noteSearch.set('');
    const note = makeNote({
      content: 'Hey @Caden Egr take a look',
      mentions: [{ type: 'person', id: 'CEgr', name: 'Caden Egr' }] as NoteMention[],
    });
    const segs = component.noteViewSegments(note);
    expect(segs.filter(s => s.kind === 'mention').map(s => s.text)).toEqual(['@Caden Egr']);
  });

  // The "Show more" toggle is driven by real clamp overflow (reported per-note by
  // ClampOverflowDirective), not by character count — so it appears for every truncated note.
  it('tracks per-note clamp overflow for the Show more toggle', () => {
    expect(component.isNoteOverflowing(1)).toBe(false);

    component.setNoteOverflow(1, true);
    component.setNoteOverflow(2, false);
    expect(component.isNoteOverflowing(1)).toBe(true);
    expect(component.isNoteOverflowing(2)).toBe(false);

    // Clearing overflow (e.g. after expand removes the clamp) drops it from the set.
    component.setNoteOverflow(1, false);
    expect(component.isNoteOverflowing(1)).toBe(false);
  });
});

describe('CustomerNotesComponent — degraded mention catalog', () => {
  function create(catalog: Partial<MentionCatalog>): CustomerNotesComponent {
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { getMentionCatalog: () => of({ people: [], tradeUnits: [], tradeUnitGroups: [], appGroups: [], teamsChannels: [], ...catalog }) } },
        { provide: TeamsDirectoryService, useValue: { getChannels: () => of([]) } },
        { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {} } },
        provideSelectedProducerEngagement(engagement = selectedProducerEngagementFake()),
        SelectedCustomerContext,
        provideProducerProfiles(),
      ],
    });
    TestBed.overrideComponent(CustomerNotesComponent, { set: { template: '', templateUrl: undefined, imports: [] } });
    const fixture = TestBed.createComponent(CustomerNotesComponent);
    fixture.componentRef.setInput('customer', makeCustomer(100));
    engagement.notes.set([]);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('is not degraded when the API answered in full', () => {
    expect(create({}).mentionCatalogDegraded()).toBe(false);
  });

  it('is degraded when the API says a source could not be read, so the picker can say so', () => {
    // The API still answers 200 with whatever it gathered; without this flag an outage looks like
    // "nobody to mention".
    expect(create({ degraded: true }).mentionCatalogDegraded()).toBe(true);
  });
});

// Real template: the input handler closes an empty dropdown, and the notice lives inside the
// dropdown, so only a rendered test shows whether the notice can actually appear.
describe('CustomerNotesComponent — degraded notice in the rendered picker', () => {
  function render(catalog: Partial<MentionCatalog>): ComponentFixture<CustomerNotesComponent> {
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { getMentionCatalog: () => of({ people: [], tradeUnits: [], tradeUnitGroups: [], appGroups: [], teamsChannels: [], ...catalog }) } },
        { provide: TeamsDirectoryService, useValue: { getChannels: () => of([]) } },
        { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {} } },
        provideSelectedProducerEngagement(engagement = selectedProducerEngagementFake()),
        SelectedCustomerContext,
        provideProducerProfiles(),
        // The rendered add-note form needs notes:write.
        providePermissions(permissionStub(['notes:write'])),
      ],
    });
    const fixture = TestBed.createComponent(CustomerNotesComponent);
    fixture.componentRef.setInput('customer', makeCustomer(100));
    engagement.notes.set([]);
    fixture.detectChanges();
    return fixture;
  }

  function typeInNote(fixture: ComponentFixture<CustomerNotesComponent>, text: string): void {
    const ta = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = text;
    ta.setSelectionRange(text.length, text.length);
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  const notice = (fixture: ComponentFixture<CustomerNotesComponent>) =>
    fixture.nativeElement.querySelector('[role="status"]') as HTMLElement | null;

  it('shows the notice when the catalog is degraded and nobody matches', () => {
    const fixture = render({ degraded: true });
    typeInNote(fixture, 'Call @zz');
    expect(fixture.componentInstance.mentionOptions()).toEqual([]);
    expect(notice(fixture)?.textContent).toContain("couldn't be loaded");
  });

  it('Escape dismisses a dropdown that shows only the degraded notice, and claims the keypress', () => {
    const fixture = render({ degraded: true });
    typeInNote(fixture, 'Call @zz');
    expect(fixture.componentInstance.mentionDropdownOpen()).toBe(true);

    const ta = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    ta.dispatchEvent(esc);
    fixture.detectChanges();

    expect(fixture.componentInstance.mentionDropdownOpen()).toBe(false);
    expect(notice(fixture)).toBeNull();
    // Claimed, so a dialog wrapping the composer would not also close on it.
    expect(esc.defaultPrevented).toBe(true);
  });

  it('still closes an empty dropdown when the catalog answered in full', () => {
    const fixture = render({});
    typeInNote(fixture, 'Call @zz');
    expect(fixture.componentInstance.mentionDropdownOpen()).toBe(false);
    expect(notice(fixture)).toBeNull();
  });
});

// Real template: adding, pinning, editing and deleting a note need notes:write.
describe('CustomerNotesComponent — write controls', () => {
  function render(granted: PermissionId[]): HTMLElement {
    const engagement = selectedProducerEngagementFake();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { getMentionCatalog: () => of({ people: [], tradeUnits: [], tradeUnitGroups: [], appGroups: [], teamsChannels: [] }) } },
        { provide: TeamsDirectoryService, useValue: { getChannels: () => of([]) } },
        { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {} } },
        provideSelectedProducerEngagement(engagement),
        SelectedCustomerContext,
        provideProducerProfiles(),
        providePermissions(permissionStub(granted)),
      ],
    });
    const fixture = TestBed.createComponent(CustomerNotesComponent);
    fixture.componentRef.setInput('customer', makeCustomer(100));
    engagement.notes.set([makeNote({ id: 1, customerId: 100, content: 'Talked about corn pricing', createdAt: new Date('2026-01-03') })]);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const labels = (host: HTMLElement) => Array.from(host.querySelectorAll('button')).map(b => (b.textContent ?? '').replace(/\s+/g, ' ').trim());

  it('offers adding, pinning, editing and deleting to a user who may write notes', () => {
    const host = render(['notes:write']);

    expect(host.querySelector('textarea')).not.toBeNull();
    expect(labels(host)).toContain('Add Note');
    expect(labels(host)).toContain('Pin');
    expect(host.textContent).toContain('Talked about corn pricing');
  });

  it('shows a user who may only read notes the notes alone', () => {
    const host = render([]);

    expect(host.querySelector('textarea')).toBeNull();
    expect(labels(host)).not.toContain('Add Note');
    expect(labels(host)).not.toContain('Pin');
    expect(host.textContent).toContain('Talked about corn pricing');
  });
});
