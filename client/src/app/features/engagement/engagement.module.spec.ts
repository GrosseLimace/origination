import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NEVER, Observable, firstValueFrom, lastValueFrom, of, throwError } from 'rxjs';
import { defaultIfEmpty } from 'rxjs/operators';
import type { Note, NoteLastContact, ReminderDue } from '@models';
import { environment } from '@env/environment';
import { engagementModule, preloadEngagement } from './engagement.module';
import { EngagementApiService } from './data-access/engagement-api.service';
import { EngagementStore } from './data-access/engagement.store';
import { FollowUpsPanelComponent } from './components/follow-ups-panel/follow-ups-panel.component';
import { NotesPanelComponent } from './components/notes-panel/notes-panel.component';
import { LastContactedBadgeComponent } from './components/contact-badges/last-contacted-badge.component';
import { FollowUpBadgeComponent } from './components/contact-badges/follow-up-badge.component';

const panels = (slot: string) => (engagementModule.customerPanels ?? []).filter(p => p.slot === slot);
const panel = (id: string) => (engagementModule.customerPanels ?? []).find(p => p.id === id)!;

describe("Engagement module: the customer screen's sidebar", () => {
  it('contributes My follow-ups above Notes to the sidebar, for every customer', () => {
    expect(panels('sidebar').map(p => [p.slot, p.id, p.order])).toEqual([
      ['sidebar', 'follow-ups', 10],
      ['sidebar', 'notes', 20],
    ]);
    expect(panels('sidebar').every(p => !p.segments?.length)).toBe(true);
  });

  it("asks for the read each card makes: the user's own follow-ups, and the producer's notes", () => {
    expect(panel('follow-ups').requires).toEqual(['reminders:read:own']);
    expect(panel('notes').requires).toEqual(['notes:read']);
  });

  it('loads each panel as its card', async () => {
    expect(await panel('follow-ups').component()).toBe(FollowUpsPanelComponent);
    expect(await panel('notes').component()).toBe(NotesPanelComponent);
  });
});

describe("Engagement module: the customer list's rows", () => {
  it('puts the last-contacted line above the follow-up line, under each row’s contact details, for every customer', () => {
    expect(panels('row-details').map(p => [p.id, p.order])).toEqual([['last-contacted', 10], ['follow-up', 20]]);
    expect(panels('row-details').every(p => !p.segments?.length)).toBe(true);
  });

  it('asks for the read each makes: the notes, and the user’s own follow-ups', () => {
    expect(panel('last-contacted').requires).toEqual(['notes:read']);
    expect(panel('follow-up').requires).toEqual(['reminders:read:own']);
  });

  it('loads each as its badge', async () => {
    expect(await panel('last-contacted').component()).toBe(LastContactedBadgeComponent);
    expect(await panel('follow-up').component()).toBe(FollowUpBadgeComponent);
  });
});

// Each of these used to resolve a failure to [] with nothing recorded, so the screens showed "Never contacted" and no
// follow-ups for an outage.
describe("Engagement preload: the last-contact summary and the user's follow-ups", () => {
  let api: Record<'getNotesLastContact' | 'getMyReminders', ReturnType<typeof vi.fn<() => Observable<unknown>>>>;
  let store: EngagementStore;

  const run = () => lastValueFrom(TestBed.runInInjectionContext(() => preloadEngagement(['1085'])).pipe(defaultIfEmpty('none')));

  beforeEach(() => {
    api = {
      getNotesLastContact: vi.fn(() => of([{ customerId: 1, lastNoteAt: new Date() }] as NoteLastContact[])),
      getMyReminders: vi.fn(() => of([{ id: 5, customerId: 1, dueAt: '2026-10-20T15:00:00Z' }] as ReminderDue[])),
    };
    TestBed.configureTestingModule({ providers: [{ provide: EngagementApiService, useValue: api }] });
    store = TestBed.inject(EngagementStore);
  });

  it('reads both into EngagementStore', async () => {
    await run();

    expect(store.noteLastContacts().map(r => r.customerId)).toEqual([1]);
    if (environment.remindersEnabled) expect(store.myReminders().map(r => r.id)).toEqual([5]);
  });

  it('drops the full notes read for the last selection', async () => {
    store.setNotes([{ id: 1 } as Note]);

    await run();

    expect(store.notesLoaded()).toBe(false);
  });

  const cases: [string, keyof typeof api, () => boolean][] = [
    ['last-contact dates', 'getNotesLastContact', () => store.noteLastContactsLoadFailed()],
    ['follow-ups', 'getMyReminders', () => store.myRemindersLoadFailed()],
  ];

  it.each(cases)('%s: recorded on failure, still resolving to none so the screens load', async (_name, call, failed) => {
    if (call === 'getMyReminders' && !environment.remindersEnabled) return;
    api[call].mockReturnValue(throwError(() => new Error('500')));

    await run();

    expect(failed()).toBe(true);
  });

  it.each(cases)('%s: a new trade-unit read starts clean, before it lands', async (_name, call, failed) => {
    if (call === 'getMyReminders' && !environment.remindersEnabled) return;
    api[call].mockReturnValueOnce(throwError(() => new Error('500'))).mockReturnValue(NEVER);
    await run();
    expect(failed()).toBe(true);

    void firstValueFrom(TestBed.runInInjectionContext(() => preloadEngagement(['2190'])));

    expect(failed()).toBe(false);
  });
});
