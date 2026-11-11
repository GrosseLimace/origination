import { Injectable, computed, inject } from '@angular/core';
import type { Customer } from '@models';
import { ProducerProfiles } from '@core/context/producer-profiles';
import { CustomerStore, LinkedProducersStore } from '@features/customers';
import { REMINDER_DUE_CLASS, reminderDueTier } from '@shared/utils/reminder-due';
import { buildLinkedProducerComponents } from '@shared/utils/linked-producers';
import { profileLinkedIds } from '@shared/utils/producer-profile';
import { EngagementStore } from './engagement.store';

/** What a badge on a customer list row says, and its colour. */
export interface ContactBadge {
  text: string;
  cssClass: string;
}

/** Bare ISO strings from the API are UTC without a Z suffix. */
function parseUtcMs(timestamp: string | Date): number {
  const raw = typeof timestamp === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(timestamp) ? timestamp + 'Z' : timestamp;
  return new Date(raw).getTime();
}

/** The whole days from today back to `ms`, or forward to it, by the local calendar. */
function daysFromToday(ms: number): number {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((day.getTime() - today.getTime()) / 86_400_000);
}

/**
 * The customer list's last-contacted and follow-up badges, worked out once for the whole list from the last-contact
 * summary and the user's follow-ups (EngagementStore), so each row only looks its customer up.
 */
@Injectable({ providedIn: 'root' })
export class ContactBadges {
  private readonly store = inject(EngagementStore);
  private readonly customers = inject(CustomerStore);
  private readonly linked = inject(LinkedProducersStore);
  private readonly profiles = inject(ProducerProfiles);

  /** The last-contact summary failed to load and nothing replaced it, so a customer with no row is unknown rather than
   *  "Never contacted". */
  readonly unavailable = computed(() => this.store.noteLastContactsLoadFailed() && this.store.noteLastContacts().length === 0);

  /** Each producer code's newest contact. Keyed by the code rather than the id: it holds for producers in other trade
   *  units, and after a link is removed. A row is the newest note CREATED on the customer: a pin or an edit isn't a
   *  contact. */
  private readonly lastByCode = computed(() => {
    const byCode = new Map<string, number>();
    for (const row of this.store.noteLastContacts()) {
      if (!row.customerCode) continue;
      const ms = parseUtcMs(row.lastNoteAt);
      const held = byCode.get(row.customerCode);
      if (held === undefined || ms > held) byCode.set(row.customerCode, ms);
    }
    return byCode;
  });

  /** Each producer code's whole linked group, A→B→C included, among the trade units' customers and the producers linked
   *  to them from other trade units, by the links in their saved details. */
  private readonly groups = computed(() => {
    const profiles = this.profiles.profiles();
    return buildLinkedProducerComponents([...this.customers.customers(), ...this.linked.crossTradeUnitCustomers()],
      c => profileLinkedIds(profiles.get(c.id)));
  });

  /** Each customer's soonest open follow-up. */
  private readonly soonestFollowUp = computed(() => {
    const soonest = new Map<number, number>();
    for (const row of this.store.myReminders()) {
      const due = parseUtcMs(row.dueAt);
      const held = soonest.get(row.customerId);
      if (held === undefined || due < held) soonest.set(row.customerId, due);
    }
    return soonest;
  });

  /**
   * When the customer, or any producer in their linked group, was last contacted. A customer without a producer code is
   * grouped with the producers their own links name.
   */
  lastContactOf(customer: Customer): ContactBadge {
    if (this.unavailable()) return { text: 'Last contact unavailable', cssClass: 'text-gray-400 dark:text-gray-500' };
    const codes = customer.scoularId
      ? this.groups().get(customer.scoularId) ?? new Set([customer.scoularId])
      : new Set(profileLinkedIds(this.profiles.profileOf(customer.id)));
    const lastByCode = this.lastByCode();
    let lastMs = -1;
    for (const code of codes) {
      const ms = lastByCode.get(code);
      if (ms !== undefined && ms > lastMs) lastMs = ms;
    }
    if (lastMs < 0) return { text: 'Never contacted', cssClass: 'text-red-500' };

    const daysAgo = Math.max(0, -daysFromToday(lastMs));
    let text: string;
    if (daysAgo === 0) text = 'Today';
    else if (daysAgo === 1) text = '1 day ago';
    else if (daysAgo < 30) text = `${daysAgo} days ago`;
    else if (daysAgo < 365) {
      const months = Math.floor(daysAgo / 30);
      text = months === 1 ? '1 month ago' : `${months} months ago`;
    } else {
      const years = Math.floor(daysAgo / 365);
      text = years === 1 ? '1 year ago' : `${years} years ago`;
    }
    return { text, cssClass: daysAgo <= 7 ? 'text-green-500' : daysAgo <= 30 ? 'text-yellow-500' : 'text-red-500' };
  }

  /**
   * The user's soonest open follow-up for the customer, or null. Not walked across the linked group, as the last contact
   * is: a follow-up is a to-do about the one customer it was set on, and on a linked producer's row it would send the
   * user to the wrong page.
   */
  followUpOf(customer: Customer): ContactBadge | null {
    const dueMs = this.soonestFollowUp().get(customer.id);
    if (dueMs === undefined) return null;
    const days = daysFromToday(dueMs);
    let text: string;
    if (days < 0) {
      const overdue = -days;
      text = overdue === 1 ? 'Follow-up overdue by 1 day' : `Follow-up overdue by ${overdue} days`;
    } else if (days === 0) {
      text = 'Follow-up today';
    } else if (days === 1) {
      text = 'Follow-up tomorrow';
    } else {
      text = `Follow-up in ${days} days`;
    }
    // The colour is the shared rule the follow-ups card reads, so the two never disagree on how urgent it is.
    const dueDay = new Date(dueMs);
    dueDay.setHours(0, 0, 0, 0);
    return { text, cssClass: REMINDER_DUE_CLASS[reminderDueTier(dueDay)] };
  }
}
