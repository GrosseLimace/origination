import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { CustomerRemindersComponent, ReminderDraft } from './customer-reminders.component';
import { Customer, Reminder } from '@models';

// Covers the two things this card actually decides: how a due date is turned into the label and
// colour a user reads, and how the local date + time they pick becomes the UTC instant that drives
// both the API and the Outlook event. Everything else is emitted to the parent.

function makeCustomer(id: number): Customer {
  return { id, name: 'Smith Farms' } as unknown as Customer;
}

function makeReminder(over: Partial<Reminder> = {}): Reminder {
  return {
    id: 1,
    customerId: 100,
    customerName: 'Smith Farms',
    dueAt: new Date().toISOString(),
    subject: 'Follow up with Smith Farms',
    isCompleted: false,
    createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    ...over,
  } as Reminder;
}

/** A local date `days` from today at 09:00, as the ISO string the API would return. */
function dueInDays(days: number): string {
  const due = new Date();
  due.setDate(due.getDate() + days);
  due.setHours(9, 0, 0, 0);
  return due.toISOString();
}

describe('CustomerRemindersComponent', () => {
  let component: CustomerRemindersComponent;
  let ref: ComponentRef<CustomerRemindersComponent>;
  let fixture: ComponentFixture<CustomerRemindersComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    // happy-dom + JIT can't fetch templateUrl; blank the template — this logic is class-level.
    TestBed.overrideComponent(CustomerRemindersComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    fixture = TestBed.createComponent(CustomerRemindersComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    ref.setInput('customer', makeCustomer(100));
    fixture.detectChanges();
  });

  describe('due labels', () => {
    it('reads as Today for a reminder due later today', () => {
      expect(component.dueLabel(makeReminder({ dueAt: dueInDays(0) }))).toBe('Today');
    });

    it('reads as Tomorrow for the next day', () => {
      expect(component.dueLabel(makeReminder({ dueAt: dueInDays(1) }))).toBe('Tomorrow');
    });

    it('counts forward in days for the near future', () => {
      expect(component.dueLabel(makeReminder({ dueAt: dueInDays(5) }))).toBe('In 5 days');
    });

    it('singularises a one-day overdue reminder', () => {
      expect(component.dueLabel(makeReminder({ dueAt: dueInDays(-1) }))).toBe('Overdue by 1 day');
    });

    it('counts backward in days when overdue', () => {
      expect(component.dueLabel(makeReminder({ dueAt: dueInDays(-4) }))).toBe('Overdue by 4 days');
    });
  });

  describe('due colours', () => {
    it('shows overdue in red', () => {
      expect(component.dueClass(makeReminder({ dueAt: dueInDays(-2) }))).toContain('red');
    });

    it('shows today in amber', () => {
      expect(component.dueClass(makeReminder({ dueAt: dueInDays(0) }))).toContain('amber');
    });

    it('shows tomorrow in green, the same as the producer-list badge', () => {
      expect(component.dueClass(makeReminder({ dueAt: dueInDays(1) }))).toContain('scoular-green');
    });

    it('greys out anything two days or more away', () => {
      expect(component.dueClass(makeReminder({ dueAt: dueInDays(2) }))).toContain('gray');
      expect(component.dueClass(makeReminder({ dueAt: dueInDays(10) }))).toContain('gray');
    });

    it('greys out a completed reminder even when it is overdue', () => {
      const completed = makeReminder({ dueAt: dueInDays(-2), isCompleted: true });
      expect(component.dueClass(completed)).toContain('gray');
    });
  });

  describe('collapsing', () => {
    it('starts collapsed', () => {
      expect(component.collapsed()).toBe(true);
    });

    it('opens and closes from the header toggle', () => {
      component.toggleCollapsed();
      expect(component.collapsed()).toBe(false);

      component.toggleCollapsed();
      expect(component.collapsed()).toBe(true);
    });

    it('counts only open follow-ups for the header badge', () => {
      ref.setInput('reminders', [
        makeReminder({ id: 1 }),
        makeReminder({ id: 2 }),
        makeReminder({ id: 3, isCompleted: true }),
      ]);
      fixture.detectChanges();

      expect(component.openCount()).toBe(2);
    });

    it('expands when adding, so the form it just opened is visible', () => {
      component.openAdd();

      expect(component.collapsed()).toBe(false);
      expect(component.formOpen()).toBe(true);
    });

    it('expands when editing', () => {
      component.openEdit(makeReminder({ id: 4, dueAt: dueInDays(2) }));

      expect(component.collapsed()).toBe(false);
    });

    it('never leaves a half-filled form hidden behind a collapsed header', () => {
      component.openAdd();
      component.formSubject.set('half typed');

      component.toggleCollapsed();

      expect(component.collapsed()).toBe(true);
      expect(component.formOpen()).toBe(false);
      expect(component.formSubject()).toBe('');
    });

    it('re-collapses when a different producer is selected', () => {
      component.openAdd();
      expect(component.collapsed()).toBe(false);

      ref.setInput('customer', makeCustomer(200));
      fixture.detectChanges();

      expect(component.collapsed()).toBe(true);
      expect(component.formOpen()).toBe(false);
    });
  });

  describe('deleting', () => {
    // Deleting is the one irreversible action on the card: completing keeps the record, deleting
    // removes it and takes the Outlook event with it. So it goes through a confirm, like a note.
    it('does not delete straight from the row', () => {
      let removed = 0;
      component.remove.subscribe(() => removed++);

      component.confirmDelete(makeReminder({ id: 5 }));

      expect(removed).toBe(0);
      expect(component.showDeleteConfirm()).toBe(true);
      expect(component.reminderToDelete()?.id).toBe(5);
    });

    it('emits the removal only once confirmed', () => {
      const emitted: number[] = [];
      component.remove.subscribe(r => emitted.push(r.id));

      component.confirmDelete(makeReminder({ id: 5 }));
      component.executeDelete();

      expect(emitted).toEqual([5]);
      expect(component.showDeleteConfirm()).toBe(false);
      expect(component.reminderToDelete()).toBeNull();
    });

    it('keeps the follow-up when the user backs out', () => {
      let removed = 0;
      component.remove.subscribe(() => removed++);

      component.confirmDelete(makeReminder({ id: 5 }));
      component.cancelDelete();

      expect(removed).toBe(0);
      expect(component.showDeleteConfirm()).toBe(false);
    });

    it('releases the page scroll lock on both exits', () => {
      component.confirmDelete(makeReminder({ id: 5 }));
      expect(document.body.style.overflow).toBe('hidden');
      component.cancelDelete();
      expect(document.body.style.overflow).toBe('');

      component.confirmDelete(makeReminder({ id: 6 }));
      component.executeDelete();
      expect(document.body.style.overflow).toBe('');
    });

    it('dismisses the confirm when a different producer is selected', () => {
      component.confirmDelete(makeReminder({ id: 5 }));

      ref.setInput('customer', makeCustomer(300));
      fixture.detectChanges();

      expect(component.showDeleteConfirm()).toBe(false);
      expect(document.body.style.overflow).toBe('');
    });
  });

  describe('the time picker', () => {
    // Our own dropdown rather than <input type="time">, because OK has to sit inside it under the
    // columns and the native dropdown is browser chrome a page cannot add to.
    it('splits the stored 24-hour value into the three columns', () => {
      component.openAdd();
      expect(component.selected()).toEqual({ hour12: 9, minute: 0, meridiem: 'AM' });

      component.formTime.set('14:30');
      expect(component.selected()).toEqual({ hour12: 2, minute: 30, meridiem: 'PM' });
    });

    it('treats midnight and noon as 12, not 0', () => {
      component.formTime.set('00:15');
      expect(component.selected()).toEqual({ hour12: 12, minute: 15, meridiem: 'AM' });

      component.formTime.set('12:45');
      expect(component.selected()).toEqual({ hour12: 12, minute: 45, meridiem: 'PM' });
    });

    it('keeps storing 24-hour time as the columns change', () => {
      component.openAdd();

      component.setHour(2);
      component.setMinute(45);
      component.setMeridiem('PM');

      expect(component.formTime()).toBe('14:45');
      expect(component.formattedTime()).toBe('2:45 PM');
    });

    it('round-trips midnight and noon through the columns', () => {
      component.setMeridiem('AM');
      component.setHour(12);
      component.setMinute(0);
      expect(component.formTime()).toBe('00:00');

      component.setMeridiem('PM');
      expect(component.formTime()).toBe('12:00');
    });

    it('changing the hour does not disturb the minute or AM/PM', () => {
      component.formTime.set('14:35');

      component.setHour(7);

      expect(component.formTime()).toBe('19:35');
    });

    it('offers five-minute steps and the twelve hours starting at 12', () => {
      expect(component.hours[0]).toBe(12);
      expect(component.hours.length).toBe(12);
      expect(component.minutes).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
      expect(component.meridiems).toEqual(['AM', 'PM']);
    });

    it('stays open while the columns are used, and closes on OK', () => {
      component.openAdd();
      component.toggleTimePicker();

      component.setHour(3);
      expect(component.timeOpen()).toBe(true);

      component.closeTimePicker();
      expect(component.timeOpen()).toBe(false);
      expect(component.selected().hour12).toBe(3);
    });

    it('closes on a click outside and on Escape', () => {
      component.openAdd();

      component.toggleTimePicker();
      component.onDocumentClick();
      expect(component.timeOpen()).toBe(false);

      component.toggleTimePicker();
      component.onEscape();
      expect(component.timeOpen()).toBe(false);
    });

    it('does not open while a save is in flight', () => {
      component.openAdd();
      ref.setInput('isSaving', true);
      fixture.detectChanges();

      component.toggleTimePicker();

      expect(component.timeOpen()).toBe(false);
    });

    it('is never left open behind a closed form', () => {
      component.openAdd();
      component.toggleTimePicker();

      component.closeForm();

      expect(component.timeOpen()).toBe(false);
    });
  });

  describe('the add/edit form', () => {
    it('opens for a new reminder defaulting to tomorrow at 9am', () => {
      component.openAdd();

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const expected = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

      expect(component.formOpen()).toBe(true);
      expect(component.editingId()).toBeNull();
      expect(component.formDate()).toBe(expected);
      expect(component.formTime()).toBe('09:00');
    });

    it('opens for an edit pre-filled from the reminder', () => {
      const due = new Date();
      due.setDate(due.getDate() + 3);
      due.setHours(14, 30, 0, 0);

      component.openEdit(makeReminder({ id: 42, dueAt: due.toISOString(), subject: 'Talk basis', notes: 'bring sheet' }));

      expect(component.editingId()).toBe(42);
      expect(component.formTime()).toBe('14:30');
      expect(component.formSubject()).toBe('Talk basis');
      expect(component.formNotes()).toBe('bring sheet');
    });

    it('cannot be saved without a date', () => {
      component.openAdd();
      component.formDate.set('');

      expect(component.canSave()).toBe(false);
    });

    it('emits the local date and time as a UTC instant', () => {
      let draft: ReminderDraft | undefined;
      component.save.subscribe(d => (draft = d));

      component.openAdd();
      component.formDate.set('2026-11-20');
      component.formTime.set('14:30');
      component.formSubject.set('  Talk basis  ');
      component.formNotes.set('   ');
      component.submit();

      // The emitted instant must be the same moment as 14:30 local on that date.
      const expected = new Date(2026, 10, 20, 14, 30, 0, 0).toISOString();
      expect(draft?.dueAt).toBe(expected);
      expect(draft?.subject).toBe('Talk basis');
      expect(draft?.notes).toBeUndefined();
      expect(draft?.id).toBeUndefined();
    });

    it('carries the id when editing', () => {
      let draft: ReminderDraft | undefined;
      component.save.subscribe(d => (draft = d));

      component.openEdit(makeReminder({ id: 7, dueAt: dueInDays(2) }));
      component.submit();

      expect(draft?.id).toBe(7);
    });

    it('does not emit while a save is already in flight', () => {
      let emissions = 0;
      component.save.subscribe(() => emissions++);

      component.openAdd();
      ref.setInput('isSaving', true);
      fixture.detectChanges();
      component.submit();

      expect(emissions).toBe(0);
    });

    it('collapses the card on cancel, back to where Add was pressed from', () => {
      component.openAdd();
      component.formSubject.set('half typed');

      component.cancelForm();

      expect(component.formOpen()).toBe(false);
      expect(component.collapsed()).toBe(true);
      expect(component.formSubject()).toBe('');
    });

    it('stays open after a successful save, so the new follow-up is visible', () => {
      component.openAdd();

      ref.setInput('saveSucceededCounter', 1);
      fixture.detectChanges();

      expect(component.formOpen()).toBe(false);
      expect(component.collapsed()).toBe(false);
    });

    it('closes and resets only once the parent reports the save succeeded', () => {
      component.openAdd();
      component.formSubject.set('Talk basis');

      // Still open while the request is in flight.
      expect(component.formOpen()).toBe(true);

      ref.setInput('saveSucceededCounter', 1);
      fixture.detectChanges();

      expect(component.formOpen()).toBe(false);
      expect(component.formSubject()).toBe('');
    });
  });
});
