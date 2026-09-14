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

    it('greys out a completed reminder even when it is overdue', () => {
      const completed = makeReminder({ dueAt: dueInDays(-2), isCompleted: true });
      expect(component.dueClass(completed)).toContain('gray');
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
