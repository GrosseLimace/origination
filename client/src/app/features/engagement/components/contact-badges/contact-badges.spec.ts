import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import type { Customer, NoteLastContact, ProducerDetails, ReminderDue } from '@models';
import { CustomerStore, CustomersApiService, LinkedProducersStore } from '@features/customers';
import { ProducerProfilesFake, producerProfilesFake, provideProducerProfiles } from '@testing/producer-profiles.fake';
import { ContactBadges } from '../../data-access/contact-badges';
import { EngagementApiService } from '../../data-access/engagement-api.service';
import { EngagementStore } from '../../data-access/engagement.store';
import { FollowUpBadgeComponent } from './follow-up-badge.component';
import { LastContactedBadgeComponent } from './last-contacted-badge.component';

/** Frozen clock: noon local time. */
const NOW = new Date('2026-10-13T12:00:00');
const DAY = 24 * 60 * 60 * 1000;

/** Noon local time N days from now. */
function daysFromNow(n: number): Date {
  const d = new Date(NOW.getTime() + n * DAY);
  d.setHours(12, 0, 0, 0);
  return d;
}

const customer = (id: number, scoularId?: string) => ({ id, scoularId, name: `P${id}` }) as Customer;
const lastContact = (customerCode: string, daysAgo: number): NoteLastContact => ({ customerId: 0, customerCode, lastNoteAt: daysFromNow(-daysAgo) });
const followUp = (id: number, customerId: number, dueAt: string): ReminderDue => ({ id, customerId, dueAt });

/**
 * The customer list's last-contacted and follow-up lines, which Engagement adds to each row: their wording and colour,
 * the linked group the last contact is read across, and the line each badge renders.
 */
describe('the customer list’s contact badges', () => {
  let badges: ContactBadges;
  let store: EngagementStore;
  let profiles: ProducerProfilesFake;
  let api: { getNotesLastContact: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    profiles = producerProfilesFake();
    api = { getNotesLastContact: vi.fn(() => of([])) };
    TestBed.configureTestingModule({
      providers: [
        { provide: EngagementApiService, useValue: api },
        { provide: CustomersApiService, useValue: {} },
        provideProducerProfiles(profiles),
      ],
    });
    badges = TestBed.inject(ContactBadges);
    store = TestBed.inject(EngagementStore);
  });

  afterEach(() => vi.useRealTimers());

  describe('the last contact', () => {
    it('words the newest note by day, month and year, and colours it by how recent it is', () => {
      store.setNoteLastContacts([
        lastContact('C1', 0), lastContact('C2', 1),
        lastContact('C3', 40), lastContact('C3', 7),   // the newest row wins
        lastContact('C4', 8), lastContact('C5', 45), lastContact('C6', 400),
      ]);
      const of = (id: number) => badges.lastContactOf(customer(id, `C${id}`));

      expect(of(1)).toEqual({ text: 'Today', cssClass: 'text-green-500' });
      expect(of(2).text).toBe('1 day ago');
      expect(of(3)).toEqual({ text: '7 days ago', cssClass: 'text-green-500' });     // ≤ 7 days
      expect(of(4)).toEqual({ text: '8 days ago', cssClass: 'text-yellow-500' });    // 8–30 days
      expect(of(5)).toEqual({ text: '1 month ago', cssClass: 'text-red-500' });      // > 30 days
      expect(of(6).text).toBe('1 year ago');
      expect(of(7)).toEqual({ text: 'Never contacted', cssClass: 'text-red-500' });
    });

    it('says it is unavailable, not "Never contacted", when the summary failed to load', () => {
      store.setNoteLastContactsLoadFailed(true);
      expect(badges.lastContactOf(customer(1, 'C1'))).toEqual({ text: 'Last contact unavailable', cssClass: 'text-gray-400 dark:text-gray-500' });

      store.setNoteLastContactsLoadFailed(false);
      expect(badges.lastContactOf(customer(1, 'C1')).text).toBe('Never contacted');
    });

    it("reads the newest note across the whole linked group, including producers linked from other trade units", () => {
      // The links are in the producers' saved details: A → B → C, and Z (another trade unit) → X.
      profiles.set([
        { customerId: 1, linkedProducerIds: 'B1' } as ProducerDetails,
        { customerId: 2, linkedProducerIds: 'C1' } as ProducerDetails,
        { customerId: 99, linkedProducerIds: 'X1' } as ProducerDetails,
      ]);
      TestBed.inject(CustomerStore).setCustomers([customer(1, 'A1'), customer(2, 'B1'), customer(3, 'C1'), customer(4, 'X1')]);
      store.setNoteLastContacts([lastContact('C1', 2), lastContact('Z1', 3)]);

      expect(badges.lastContactOf(customer(1, 'A1')).text).toBe('2 days ago');
      expect(badges.lastContactOf(customer(2, 'B1')).text).toBe('2 days ago');
      expect(badges.lastContactOf(customer(4, 'X1')).text).toBe('Never contacted');

      // Once the home page fetches Z, X picks up Z's note.
      TestBed.inject(LinkedProducersStore).put(customer(99, 'Z1'));
      expect(badges.lastContactOf(customer(4, 'X1')).text).toBe('3 days ago');
    });

    it('groups a customer without a producer code with the producers their own links name', () => {
      profiles.set([{ customerId: 7, linkedProducerIds: 'C1' } as ProducerDetails]);
      store.setNoteLastContacts([lastContact('C1', 1)]);

      expect(badges.lastContactOf(customer(7)).text).toBe('1 day ago');
    });
  });

  describe('the follow-up', () => {
    it('shows the soonest open follow-up per customer, as overdue, today, tomorrow or in N days, coloured by urgency', () => {
      store.setMyReminders([
        followUp(1, 1, '2026-10-18T12:00:00Z'),
        followUp(2, 1, '2026-10-11T12:00:00Z'),   // the soonest: two days overdue
        followUp(3, 2, '2026-10-13T12:00:00Z'),
        followUp(4, 3, '2026-10-14T12:00:00Z'),
        followUp(5, 4, '2026-10-17T12:00:00Z'),
      ]);
      const of = (id: number) => badges.followUpOf(customer(id));

      expect(of(1)?.text).toBe('Follow-up overdue by 2 days');
      expect(of(1)?.cssClass).toContain('text-red-600');
      expect(of(2)?.text).toBe('Follow-up today');
      expect(of(2)?.cssClass).toContain('text-amber-600');
      expect(of(3)?.text).toBe('Follow-up tomorrow');
      expect(of(4)?.text).toBe('Follow-up in 4 days');
      expect(of(4)?.cssClass).toContain('text-gray-500');
      expect(of(5)).toBeNull();
    });

    // A follow-up is about the one customer it was set on: on a linked producer's row it would send the user to the
    // wrong page.
    it('is not read across the linked group', () => {
      profiles.set([{ customerId: 1, linkedProducerIds: 'B1' } as ProducerDetails]);
      TestBed.inject(CustomerStore).setCustomers([customer(1, 'A1'), customer(2, 'B1')]);
      store.setMyReminders([followUp(1, 1, '2026-10-14T12:00:00Z')]);

      expect(badges.followUpOf(customer(2, 'B1'))).toBeNull();
    });
  });

  describe('the badges on a row', () => {
    const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

    it('the last-contacted line shows the customer’s, in its colour, and asks for the summary once however many rows show', () => {
      api.getNotesLastContact.mockReturnValue(of([lastContact('C1', 0)]));
      const first = TestBed.createComponent(LastContactedBadgeComponent);
      first.componentRef.setInput('customer', customer(1, 'C1'));
      first.detectChanges();
      const second = TestBed.createComponent(LastContactedBadgeComponent);
      second.componentRef.setInput('customer', customer(2, 'C2'));
      second.detectChanges();

      expect(text(first.nativeElement)).toBe('Today');
      expect(first.nativeElement.querySelector('div').className).toContain('text-green-500');
      expect(text(second.nativeElement)).toBe('Never contacted');
      expect(api.getNotesLastContact).toHaveBeenCalledTimes(1);
    });

    it('the follow-up line shows only when the user has one for the customer, and goes when it is done', () => {
      store.setMyReminders([followUp(1, 1, '2026-10-14T12:00:00Z')]);
      const fixture = TestBed.createComponent(FollowUpBadgeComponent);
      fixture.componentRef.setInput('customer', customer(1));
      fixture.detectChanges();
      expect(text(fixture.nativeElement)).toBe('Follow-up tomorrow');

      store.setMyReminders([]);
      fixture.detectChanges();
      expect(text(fixture.nativeElement)).toBe('');
    });
  });
});
