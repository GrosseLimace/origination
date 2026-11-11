import { inject } from '@angular/core';
import { EMPTY, Observable, merge, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { ModuleManifest } from '@core/modules/module-manifest';
import { environment } from '@env/environment';
import type { ReminderDue } from '@models';
import { EngagementApiService } from './data-access/engagement-api.service';
import { EngagementStore } from './data-access/engagement.store';

/**
 * What Engagement loads for a new trade-unit selection: the last-contact summary and the signed-in user's open
 * follow-ups (while follow-ups are switched on), which the customer list's badges, Build a List's prompts and the
 * Planting Dashboard read. Both cover every trade unit; the full notes held for the last selection drop, and a prompt
 * that reads note bodies reads them again. A failed read is recorded, so it doesn't read as "never contacted" or "no
 * follow-ups".
 */
export function preloadEngagement(_tradeUnits: readonly string[]): Observable<unknown> {
  const store = inject(EngagementStore);
  const api = inject(EngagementApiService);
  store.clearLoadFailures();
  store.clearNotesCache();
  const reminders$ = environment.remindersEnabled
    ? api.getMyReminders().pipe(
        catchError(() => { store.setMyRemindersLoadFailed(true); return of([] as ReminderDue[]); }),
        tap(rows => store.setMyReminders(rows ?? [])),
      )
    : EMPTY;
  return merge(store.readLastContacts(), reminders$);
}

export const engagementModule: ModuleManifest = {
  id: 'engagement',
  preload: preloadEngagement,
  // Recap groups: who gets the daily recap, and who can be @-mentioned in notes. The page kept the Daily Digest
  // path it launched with.
  routes: [
    {
      path: 'daily-digest',
      requires: ['recap-groups:read'],
      loadComponent: () => import('./pages/daily-digest/daily-digest.component').then(m => m.DailyDigestComponent),
    },
  ],
  nav: [
    {
      requires: ['recap-groups:read'],
      label: 'Manage Groups',
      path: '/daily-digest',
      icon: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7'],
      order: 20,
      menu: 'user',
    },
  ],
  // The home page's right column: the user's follow-ups for the producer above the producer's notes. Both apply to
  // every customer; adding and changing them needs reminders:write:own and notes:write, which the cards check.
  customerPanels: [
    {
      slot: 'sidebar',
      id: 'follow-ups',
      requires: ['reminders:read:own'],
      order: 10,
      component: () => import('./components/follow-ups-panel/follow-ups-panel.component').then(m => m.FollowUpsPanelComponent),
    },
    {
      slot: 'sidebar',
      id: 'notes',
      requires: ['notes:read'],
      order: 20,
      component: () => import('./components/notes-panel/notes-panel.component').then(m => m.NotesPanelComponent),
    },
    // Each customer list row's lines under the address, phone and email: when the customer or their linked group was
    // last contacted, and the user's soonest follow-up for them. For every customer.
    {
      slot: 'row-details',
      id: 'last-contacted',
      requires: ['notes:read'],
      order: 10,
      component: () => import('./components/contact-badges/last-contacted-badge.component').then(m => m.LastContactedBadgeComponent),
    },
    {
      slot: 'row-details',
      id: 'follow-up',
      requires: ['reminders:read:own'],
      order: 20,
      component: () => import('./components/contact-badges/follow-up-badge.component').then(m => m.FollowUpBadgeComponent),
    },
  ],
};
