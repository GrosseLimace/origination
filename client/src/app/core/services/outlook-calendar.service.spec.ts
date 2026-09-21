import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { OutlookCalendarService } from './outlook-calendar.service';
import { ApiService } from '@core/services/api.service';
import { Reminder } from '@models';

// The Graph call moved into the API on 2026-09-15, so almost everything this spec used to guard —
// the /me/events endpoint, the unzoned local literal, the 30-minute block, the HTML escaping, the
// patch-don't-recreate rule, 404-as-success — now lives in OutlookCalendarServiceTests on the
// backend. What is left here is the browser's remaining job: send the time zone, and never let a
// calendar failure escape.

function makeReminder(over: Partial<Reminder> = {}): Reminder {
  return {
    id: 1,
    customerId: 10,
    customerName: 'Smith Farms',
    dueAt: '2026-03-10T15:30:00Z',
    subject: 'Follow up',
    isCompleted: false,
    createdAt: '2026-03-01T00:00:00Z',
    ...over,
  } as Reminder;
}

describe('OutlookCalendarService', () => {
  let api: { addReminderToOutlook: ReturnType<typeof vi.fn> };

  function build(): OutlookCalendarService {
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }],
    });
    return TestBed.inject(OutlookCalendarService);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    api = { addReminderToOutlook: vi.fn(() => of(makeReminder({ outlookEventId: 'AAMkAD==' }))) };
  });

  it('asks the API to write the event, never Graph directly', async () => {
    const service = build();

    const result = await new Promise(resolve =>
      service.addToOutlook(makeReminder(), 'https://origination/?customerId=10').subscribe(resolve));

    expect(api.addReminderToOutlook).toHaveBeenCalledTimes(1);
    expect((result as Reminder).outlookEventId).toBe('AAMkAD==');
  });

  it('sends the browser time zone, because the server cannot know where the user is', async () => {
    const service = build();

    await new Promise(resolve =>
      service.addToOutlook(makeReminder(), 'https://origination/?customerId=10').subscribe(resolve));

    const [, body] = api.addReminderToOutlook.mock.calls[0];
    expect(body.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    expect(body.producerLink).toBe('https://origination/?customerId=10');
  });

  it('resolves null instead of throwing when the API call fails', async () => {
    // A calendar failure must never disturb a reminder that is already saved.
    api.addReminderToOutlook = vi.fn(() => throwError(() => new Error('boom')));
    const service = build();

    const result = await new Promise(resolve =>
      service.addToOutlook(makeReminder(), 'https://x').subscribe(resolve));

    expect(result).toBeNull();
  });

  it('exposes the current time zone for a save to send along', () => {
    // The reschedule path rides on the ordinary save, so the component needs this separately.
    expect(OutlookCalendarService.currentTimeZone())
      .toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  });
});
