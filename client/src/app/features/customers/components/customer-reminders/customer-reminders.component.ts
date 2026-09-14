import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@shared/components/button/button.component';
import { Customer, Reminder } from '@models';

/** What the card emits when the user saves the add/edit form. `id` is absent for a new one. */
export interface ReminderDraft {
  id?: number;
  /** Due instant as a UTC ISO string, converted from the local date + time the user picked. */
  dueAt: string;
  subject: string;
  notes?: string;
}

/** Time of day used when the user picks a date but leaves the time alone. */
const DEFAULT_TIME = '09:00';

/**
 * "My follow-ups" card on the producer pane — the signed-in user's own reminders for this
 * producer, plus the form to add or edit one.
 *
 * The card is deliberately dumb: it owns only form state and presentation. Every save, complete,
 * delete and Outlook retry goes out as an event so the parent page can keep the API call, the
 * calendar write and the badge feed in step.
 */
@Component({
  selector: 'app-customer-reminders',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customer-reminders.component.html'
})
export class CustomerRemindersComponent {
  public reminders = input<Reminder[]>([]);
  public customer = input.required<Customer>();
  /** True while the parent fetches this producer's reminders. Shows a spinner rather than the
   *  empty state, so a producer WITH follow-ups never flashes "none scheduled". */
  public isLoading = input<boolean>(false);
  /** True while a create/update is in flight — disables the form and labels the button "Saving...". */
  public isSaving = input<boolean>(false);
  /** Incremented by the parent on each SUCCESSFUL save. Only then does the form close and reset,
   *  so a failed save leaves the user's typing intact to retry. */
  public saveSucceededCounter = input<number>(0);

  public save = output<ReminderDraft>();
  public toggleComplete = output<Reminder>();
  public remove = output<Reminder>();
  /** User asked to (re)create the Outlook event for a reminder that has no linked event. */
  public addToOutlook = output<Reminder>();

  formOpen = signal(false);
  /** Id being edited; null means the form is composing a new reminder. */
  editingId = signal<number | null>(null);
  formDate = signal('');
  formTime = signal(DEFAULT_TIME);
  formSubject = signal('');
  formNotes = signal('');

  /** Today in the user's local zone, as the date input min so a past day cannot be picked. */
  readonly todayIso = this.toDateInput(new Date());

  readonly canSave = computed(() => this.formDate().trim().length > 0 && !this.isSaving());

  constructor() {
    // Close and reset only once the parent confirms the save landed.
    effect(() => {
      if (this.saveSucceededCounter() > 0) {
        this.closeForm();
      }
    });
  }

  // ---- form ----------------------------------------------------------------
  openAdd(): void {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    this.editingId.set(null);
    this.formDate.set(this.toDateInput(tomorrow));
    this.formTime.set(DEFAULT_TIME);
    this.formSubject.set('');
    this.formNotes.set('');
    this.formOpen.set(true);
  }

  openEdit(reminder: Reminder): void {
    const due = new Date(reminder.dueAt);

    this.editingId.set(reminder.id);
    this.formDate.set(this.toDateInput(due));
    this.formTime.set(this.toTimeInput(due));
    this.formSubject.set(reminder.subject);
    this.formNotes.set(reminder.notes ?? '');
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.editingId.set(null);
    this.formDate.set('');
    this.formTime.set(DEFAULT_TIME);
    this.formSubject.set('');
    this.formNotes.set('');
  }

  submit(): void {
    if (!this.canSave()) return;

    const id = this.editingId();
    this.save.emit({
      ...(id === null ? {} : { id }),
      dueAt: this.toUtcIso(this.formDate(), this.formTime()),
      subject: this.formSubject().trim(),
      notes: this.formNotes().trim() || undefined,
    });
  }

  // ---- presentation --------------------------------------------------------
  /** "Overdue by 2 days" / "Today" / "Tomorrow" / "In 5 days", from whole local days. */
  dueLabel(reminder: Reminder): string {
    const days = this.daysUntil(reminder.dueAt);
    if (days < -1) return `Overdue by ${Math.abs(days)} days`;
    if (days === -1) return 'Overdue by 1 day';
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 30) return `In ${days} days`;
    const months = Math.floor(days / 30);
    return months === 1 ? 'In 1 month' : `In ${months} months`;
  }

  dueClass(reminder: Reminder): string {
    if (reminder.isCompleted) return 'text-gray-400 dark:text-gray-500';
    const days = this.daysUntil(reminder.dueAt);
    if (days < 0) return 'text-red-600 dark:text-red-400';
    if (days === 0) return 'text-amber-600 dark:text-amber-400';
    return 'text-gray-600 dark:text-gray-300';
  }

  /** Whole days from today (local midnight) to the due date — negative means overdue. */
  private daysUntil(dueAt: string): number {
    const due = new Date(dueAt);
    due.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((due.getTime() - today.getTime()) / 86_400_000);
  }

  // ---- date helpers --------------------------------------------------------
  /**
   * Combines the local date and time the user picked into a UTC ISO instant. Built from local
   * parts on purpose: the user means 9am where they are, and the same instant then drives both the
   * badge and the Outlook event.
   */
  private toUtcIso(date: string, time: string): string {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = (time || DEFAULT_TIME).split(':').map(Number);
    return new Date(year, (month ?? 1) - 1, day, hour ?? 9, minute ?? 0, 0, 0).toISOString();
  }

  private toDateInput(value: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }

  private toTimeInput(value: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }

  trackById(_index: number, reminder: Reminder): number {
    return reminder.id;
  }
}
