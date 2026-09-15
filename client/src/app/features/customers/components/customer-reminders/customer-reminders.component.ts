import { ChangeDetectionStrategy, Component, computed, effect, HostListener, input, output, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CardTitleComponent } from '@shared/components/card/card.component';
import { Customer, Reminder } from '@models';
import { daysUntilDue, REMINDER_DONE_CLASS, REMINDER_DUE_CLASS, reminderDueTier } from '@shared/utils/reminder-due';

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

/** Minutes offered in the picker, five apart — fine enough to schedule a call around. */
const MINUTE_STEP = 5;

/** Hours as the native picker orders them: 12 first, then 1 through 11. */
const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);

const MERIDIEMS = ['AM', 'PM'] as const;
type Meridiem = (typeof MERIDIEMS)[number];

/** Splits "14:30" into the three things the picker columns show. */
function splitTime(value: string): { hour12: number; minute: number; meridiem: Meridiem } {
  const [rawHour, rawMinute] = (value || DEFAULT_TIME).split(':').map(Number);
  const hour24 = Number.isFinite(rawHour) ? Math.min(23, Math.max(0, rawHour)) : 9;
  const minute = Number.isFinite(rawMinute) ? Math.min(59, Math.max(0, rawMinute)) : 0;
  return {
    hour12: hour24 % 12 === 0 ? 12 : hour24 % 12,
    minute,
    meridiem: hour24 < 12 ? 'AM' : 'PM',
  };
}

/** The inverse of splitTime: three columns back to the "HH:mm" the form stores. */
function joinTime(hour12: number, minute: number, meridiem: Meridiem): string {
  const base = hour12 % 12;
  const hour24 = meridiem === 'AM' ? base : base + 12;
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * The Follow-Up card on the producer pane — the signed-in user's own reminders for this producer,
 * plus the form to add or edit one.
 *
 * Renders its own header row (title, count, Add button) rather than taking one from the host, so
 * the title and the button sit on a single line and the whole card can collapse behind them. It
 * starts COLLAPSED: most producers have no follow-up, and the pane below it is already dense.
 *
 * Beyond that the card is deliberately dumb — it owns only form and collapse state. Every save,
 * complete, delete and Outlook retry goes out as an event so the parent page can keep the API call,
 * the calendar write and the badge feed in step.
 */
@Component({
  selector: 'app-customer-reminders',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, CardTitleComponent],
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

  /** Collapsed by default — see the class comment. */
  collapsed = signal(true);

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

  /** Open follow-ups only. Shown next to the title so a collapsed card still says there is work. */
  readonly openCount = computed(() => this.reminders().filter(r => !r.isCompleted).length);

  /**
   * Whether our time dropdown is showing.
   *
   * This is our own dropdown rather than <input type="time"> because the OK button has to live
   * INSIDE it, under the columns. The native dropdown is browser chrome: a page cannot add anything
   * to it, and anything drawn beneath the field is covered by it. The columns below mirror the
   * native layout so the control still behaves the way it did.
   */
  timeOpen = signal(false);

  readonly hours = HOURS_12;
  readonly minutes = MINUTES;
  readonly meridiems = MERIDIEMS;

  /** The current selection, split into the three columns. */
  readonly selected = computed(() => splitTime(this.formTime()));

  /** The chosen time as the user reads it, e.g. "9:05 AM". Shown on the closed field. */
  readonly formattedTime = computed(() => {
    const { hour12, minute, meridiem } = this.selected();
    return `${hour12}:${String(minute).padStart(2, '0')} ${meridiem}`;
  });

  private _lastCustomerId: number | null = null;

  constructor() {
    // Close and reset only once the parent confirms the save landed.
    effect(() => {
      if (this.saveSucceededCounter() > 0) {
        this.closeForm();
      }
    });

    // The host reuses this component across producers, so "starts collapsed" has to mean per
    // producer, not per page load. Without this, opening one producer would leave the card open
    // for every producer clicked afterwards, and a half-typed form could follow you to another.
    effect(() => {
      const id = this.customer()?.id ?? null;
      untracked(() => {
        if (id === this._lastCustomerId) return;
        this._lastCustomerId = id;
        this.collapsed.set(true);
        this.closeForm();
      });
    });
  }

  // ---- time picker ---------------------------------------------------------
  /** Any click reaching the document closes the dropdown; the picker stops its own clicks. */
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.timeOpen()) this.timeOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.timeOpen()) this.timeOpen.set(false);
  }

  toggleTimePicker(): void {
    if (this.isSaving()) return;
    this.timeOpen.update(open => !open);
  }

  /** OK. The columns already applied every change, so this only dismisses. */
  closeTimePicker(): void {
    this.timeOpen.set(false);
  }

  setHour(hour12: number): void {
    const { minute, meridiem } = this.selected();
    this.formTime.set(joinTime(hour12, minute, meridiem));
  }

  setMinute(minute: number): void {
    const { hour12, meridiem } = this.selected();
    this.formTime.set(joinTime(hour12, minute, meridiem));
  }

  setMeridiem(meridiem: Meridiem): void {
    const { hour12, minute } = this.selected();
    this.formTime.set(joinTime(hour12, minute, meridiem));
  }

  // ---- collapse ------------------------------------------------------------
  toggleCollapsed(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    // Never leave a half-filled form hidden behind a collapsed header.
    if (next) this.closeForm();
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
    // Adding from a collapsed card has to reveal the form it just opened.
    this.collapsed.set(false);
  }

  openEdit(reminder: Reminder): void {
    const due = new Date(reminder.dueAt);

    this.collapsed.set(false);
    this.editingId.set(reminder.id);
    this.formDate.set(this.toDateInput(due));
    this.formTime.set(this.toTimeInput(due));
    this.formSubject.set(reminder.subject);
    this.formNotes.set(reminder.notes ?? '');
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.timeOpen.set(false);
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
    if (reminder.isCompleted) return REMINDER_DONE_CLASS;
    return REMINDER_DUE_CLASS[reminderDueTier(reminder.dueAt)];
  }

  private daysUntil(dueAt: string): number {
    return daysUntilDue(dueAt);
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
