import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { of } from 'rxjs';
import { CustomerNotesComponent } from './customer-notes.component';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { Customer, Note, NoteMention } from '@models';

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

describe('CustomerNotesComponent — note search filter + highlight', () => {
  let component: CustomerNotesComponent;
  let ref: ComponentRef<CustomerNotesComponent>;
  let fixture: ComponentFixture<CustomerNotesComponent>;

  const notes: Note[] = [
    makeNote({ id: 1, customerId: 100, content: 'Talked about corn pricing', createdAt: new Date('2026-01-03') }),
    makeNote({ id: 2, customerId: 100, content: 'Soybean delivery scheduled', createdAt: new Date('2026-01-02') }),
    makeNote({ id: 3, customerId: 200, content: 'Wheat basis question', createdAt: new Date('2026-01-01') }),
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { getMentionCatalog: () => of({ people: [], tradeUnits: [], groups: [] }) } },
        { provide: ToastService, useValue: { error: () => {}, success: () => {}, warning: () => {} } },
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
    ref.setInput('notes', notes);
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
    ref.setInput('notes', [
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
    ref.setInput('notes', [
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
