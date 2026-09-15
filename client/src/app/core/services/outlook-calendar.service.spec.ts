import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { MsalService } from '@azure/msal-angular';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { of, throwError } from 'rxjs';
import { OutlookCalendarService } from './outlook-calendar.service';
import { Reminder } from '@models';

// The contract this service has to keep: it writes only the signed-in user's own calendar, it
// shapes the payload the way Graph expects, and it NEVER fails loudly — a calendar problem must
// not take a saved reminder down with it.

function makeReminder(over: Partial<Reminder> = {}): Reminder {
  return {
    id: 1,
    customerId: 100,
    customerName: 'Smith Farms',
    dueAt: new Date(2026, 10, 20, 14, 30, 0).toISOString(),
    subject: 'Follow up with Smith Farms',
    isCompleted: false,
    createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    ...over,
  } as Reminder;
}

describe('OutlookCalendarService', () => {
  let service: OutlookCalendarService;
  let http: { post: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  let acquireTokenSilent: ReturnType<typeof vi.fn>;
  let acquireTokenPopup: ReturnType<typeof vi.fn>;

  const account = { homeAccountId: 'abc', username: 'alice@scoular.com' };

  beforeEach(() => {
    http = {
      post: vi.fn(() => of({ id: 'AAMkAD==' })),
      patch: vi.fn(() => of({})),
      delete: vi.fn(() => of({})),
    };
    acquireTokenSilent = vi.fn(() => Promise.resolve({ accessToken: 'token-123' }));
    acquireTokenPopup = vi.fn(() => Promise.resolve({ accessToken: 'popup-token' }));

    TestBed.configureTestingModule({
      providers: [
        OutlookCalendarService,
        { provide: HttpClient, useValue: http },
        {
          provide: MsalService,
          useValue: {
            instance: {
              getActiveAccount: () => account,
              getAllAccounts: () => [account],
              acquireTokenSilent,
              acquireTokenPopup,
            },
          },
        },
      ],
    });
    service = TestBed.inject(OutlookCalendarService);
  });

  describe('createEvent', () => {
    it('posts to the signed-in user own calendar, never another mailbox', async () => {
      await new Promise<void>(resolve => service.createEvent(makeReminder(), 'https://app/?customerId=100').subscribe(() => resolve()));

      const [url] = http.post.mock.calls[0];
      expect(url).toBe('https://graph.microsoft.com/v1.0/me/events');
    });

    it('asks only for the calendar scope', async () => {
      await new Promise<void>(resolve => service.createEvent(makeReminder(), 'https://app').subscribe(() => resolve()));

      expect(acquireTokenSilent).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['Calendars.ReadWrite'] }));
    });

    it('sends an unzoned local literal plus a time zone, not an offset string', async () => {
      await new Promise<void>(resolve => service.createEvent(makeReminder(), 'https://app').subscribe(() => resolve()));

      const [, body] = http.post.mock.calls[0];
      expect(body.start.dateTime).toBe('2026-11-20T14:30:00');
      expect(body.start.dateTime).not.toMatch(/[Zz]|[+-]\d{2}:\d{2}$/);
      expect(body.start.timeZone).toBeTruthy();
    });

    it('books a 30 minute block with a 15 minute reminder', async () => {
      await new Promise<void>(resolve => service.createEvent(makeReminder(), 'https://app').subscribe(() => resolve()));

      const [, body] = http.post.mock.calls[0];
      expect(body.end.dateTime).toBe('2026-11-20T15:00:00');
      expect(body.isReminderOn).toBe(true);
      expect(body.reminderMinutesBeforeStart).toBe(15);
    });

    it('links back to the producer and escapes user text in the body', async () => {
      const reminder = makeReminder({ notes: 'ask about <corn> & "basis"' });
      await new Promise<void>(resolve => service.createEvent(reminder, 'https://app/?customerId=100').subscribe(() => resolve()));

      const [, body] = http.post.mock.calls[0];
      expect(body.body.content).toContain('https://app/?customerId=100');
      expect(body.body.content).toContain('&lt;corn&gt;');
      expect(body.body.content).not.toContain('<corn>');
    });

    it('resolves the Graph event id', async () => {
      const id = await new Promise(resolve => service.createEvent(makeReminder(), 'https://app').subscribe(resolve));

      expect(id).toBe('AAMkAD==');
    });

    it('resolves null instead of throwing when Graph rejects the write', async () => {
      http.post.mockReturnValue(throwError(() => ({ status: 403 })));

      const id = await new Promise(resolve => service.createEvent(makeReminder(), 'https://app').subscribe(resolve));

      expect(id).toBeNull();
    });

    it('falls back to a popup when consent is still required', async () => {
      acquireTokenSilent.mockReturnValue(Promise.reject(new InteractionRequiredAuthError('consent_required')));

      const id = await new Promise(resolve => service.createEvent(makeReminder(), 'https://app').subscribe(resolve));

      expect(acquireTokenPopup).toHaveBeenCalled();
      expect(id).toBe('AAMkAD==');
    });

    it('resolves null when the user dismisses the consent popup', async () => {
      acquireTokenSilent.mockReturnValue(Promise.reject(new InteractionRequiredAuthError('consent_required')));
      acquireTokenPopup.mockReturnValue(Promise.reject(new Error('user_cancelled')));

      const id = await new Promise(resolve => service.createEvent(makeReminder(), 'https://app').subscribe(resolve));

      expect(id).toBeNull();
      expect(http.post).not.toHaveBeenCalled();
    });
  });

  describe('updateEventWindow', () => {
    it('patches only the start and end so Outlook moves the event instead of cancelling it', async () => {
      const moved = new Date(2026, 10, 25, 9, 0, 0).toISOString();

      await new Promise<void>(resolve => service.updateEventWindow('AAMkAD==', moved).subscribe(() => resolve()));

      const [url, patch] = http.patch.mock.calls[0];
      expect(url).toBe('https://graph.microsoft.com/v1.0/me/events/AAMkAD==');
      expect(Object.keys(patch).sort()).toEqual(['end', 'start']);
      expect(patch.start.dateTime).toBe('2026-11-25T09:00:00');
    });

    it('reports false rather than throwing when the move fails', async () => {
      http.patch.mockReturnValue(throwError(() => ({ status: 500 })));

      const moved = await new Promise(resolve => service.updateEventWindow('x', new Date().toISOString()).subscribe(resolve));

      expect(moved).toBe(false);
    });
  });

  describe('deleteEvent', () => {
    it('deletes the event from the user own calendar', async () => {
      await new Promise<void>(resolve => service.deleteEvent('AAMkAD==').subscribe(() => resolve()));

      expect(http.delete.mock.calls[0][0]).toBe('https://graph.microsoft.com/v1.0/me/events/AAMkAD==');
    });

    it('treats an already-missing event as success', async () => {
      http.delete.mockReturnValue(throwError(() => ({ status: 404 })));

      const deleted = await new Promise(resolve => service.deleteEvent('gone').subscribe(resolve));

      expect(deleted).toBe(true);
    });
  });

  it('does nothing at all when nobody is signed in', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        OutlookCalendarService,
        { provide: HttpClient, useValue: http },
        {
          provide: MsalService,
          useValue: { instance: { getActiveAccount: () => null, getAllAccounts: () => [], acquireTokenSilent, acquireTokenPopup } },
        },
      ],
    });
    const anonymous = TestBed.inject(OutlookCalendarService);

    const id = await new Promise(resolve => anonymous.createEvent(makeReminder(), 'https://app').subscribe(resolve));

    expect(id).toBeNull();
    expect(acquireTokenSilent).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });
});
