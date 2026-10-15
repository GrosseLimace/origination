import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';

import { ContactUpdate, CustomerDetail } from '../../../core/api/mobile-api.service';
import { formatPhone, mailtoHref, mapsAddressHref, telHref } from '../../../core/util/contact-links';
import { NoticeService } from '../../../core/errors/notice.service';
import { INPUT_CLASS, SaveFn, saveErrorMessage } from './farm.model';

interface ContactRow { name: string; phone: string; email: string; isPrimary: boolean }

/**
 * Contact card, in the desktop profile's order (user 2026-10-14): the entered contacts first, the primary one
 * starred at the top, then the producer's own address (opens Maps), phone and email from the master data.
 * Everything is tappable. "Edit" in the corner edits the entered contacts — name, phone, email, which one is
 * primary, add and remove — like the desktop Edit dialog. The master-data address, phone and email are not
 * edited here (they come from the producer record).
 */
@Component({
  selector: 'mob-contact-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let c = customer();
    <section class="mob-card" aria-labelledby="ov-contact">
      <div class="flex items-center justify-between min-h-11">
        <div class="min-w-0">
          <h2 id="ov-contact" class="mob-label">Contact</h2>
          @if (syncPending()) { <p class="truncate text-xs font-medium text-amber-700 dark:text-amber-400">Saved on this phone · waiting to sync</p> }
        </div>
        @if (!editing() && !locked()) {
          <button type="button" class="mob-tap -mr-2 px-3 text-sm font-semibold text-scoular-green-accessible dark:text-scoular-green disabled:opacity-50"
                  [disabled]="!canEdit()" (click)="startEdit()">Edit</button>
        }
      </div>

      @if (editing()) {
        <form class="mt-2 space-y-3 pb-16" (submit)="save($event)" novalidate>
          @for (r of rows(); track $index; let i = $index) {
            <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-2 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <button type="button" class="mob-tap -ml-1 px-2 text-sm gap-1" [attr.aria-pressed]="r.isPrimary" (click)="makePrimary(i)"
                        [class]="r.isPrimary ? 'text-scoular-green-accessible dark:text-scoular-green font-semibold' : 'text-gray-500 dark:text-gray-400'">
                  <span aria-hidden="true">{{ r.isPrimary ? '★' : '☆' }}</span>{{ r.isPrimary ? 'Primary' : 'Make primary' }}
                </button>
                <button type="button" class="mob-tap px-2 text-sm text-red-700 dark:text-red-400" (click)="removeRow(i)" [attr.aria-label]="'Remove contact ' + (r.name || (i + 1))">Remove</button>
              </div>
              <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Name</span>
                <input type="text" maxlength="200" autocomplete="off" [class]="inputClass" [value]="r.name" (input)="patch(i, { name: text($event) })"
                       [attr.aria-invalid]="showErrors() && !r.name.trim()"></label>
              @if (showErrors() && !r.name.trim()) { <p class="text-xs text-red-700 dark:text-red-400">Each contact needs a name.</p> }
              <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Phone</span>
                <input type="tel" inputmode="tel" maxlength="50" autocomplete="off" [class]="inputClass" [value]="r.phone" (input)="patch(i, { phone: text($event) })"></label>
              <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Email</span>
                <input type="email" inputmode="email" maxlength="255" autocomplete="off" [class]="inputClass" [value]="r.email" (input)="patch(i, { email: text($event) })"></label>
            </div>
          } @empty {
            <p class="text-sm text-gray-500 dark:text-gray-400">No contacts added. Use "+ Add contact" for people or numbers (Dad's cell, the shop line).</p>
          }
          <button type="button" class="mob-tap -ml-2 px-2 text-sm font-semibold text-scoular-green-accessible dark:text-scoular-green" (click)="addRow()">+ Add contact</button>

          <div class="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 px-4 py-2 flex justify-end gap-2"
               [style.padding-bottom]="'calc(0.5rem + var(--mob-safe-bottom))'">
            <button type="button" class="mob-tap px-4 border border-gray-300 dark:border-gray-600 font-semibold" [disabled]="saving()" (click)="editing.set(false)">Cancel</button>
            <button type="submit" class="mob-tap px-5 bg-scoular-green-accessible text-white font-semibold disabled:opacity-50" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save' }}</button>
          </div>
        </form>
      } @else {
        <div class="mt-1 divide-y divide-gray-100 dark:divide-gray-700">
          @for (p of c.contacts; track $index) {
            <div class="py-2">
              <div class="flex items-center gap-2">
                @if (p.isPrimary) { <span class="text-scoular-green-accessible dark:text-scoular-green" title="Primary contact" aria-label="Primary">★</span> }
                <span class="font-semibold text-gray-900 dark:text-gray-100">{{ p.name }}</span>
              </div>
              @if (p.phone) { <a [href]="telHref(p.phone)" class="flex items-center min-h-11 text-scoular-green-accessible dark:text-blue-400">{{ formatPhone(p.phone) }}</a> }
              @if (p.email) { <a [href]="mailtoHref(p.email)" class="flex items-center min-h-11 break-all text-scoular-green-accessible dark:text-blue-400">{{ p.email }}</a> }
            </div>
          }
          @if (mapsHref(); as href) {
            <a [href]="href" target="_blank" rel="noopener noreferrer" class="flex items-center gap-3 min-h-12 py-2 text-scoular-green-accessible dark:text-blue-400">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              <span class="text-base">{{ addressLine() }}</span>
            </a>
          } @else if (addressLine()) {
            <p class="flex items-center min-h-12 py-2 text-gray-700 dark:text-gray-200">{{ addressLine() }}</p>
          }
          @if (c.phone) {
            <a [href]="telHref(c.phone)" class="flex items-center gap-3 min-h-12 py-2 text-scoular-green-accessible dark:text-blue-400">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              <span class="text-base">{{ formatPhone(c.phone) }}</span>
            </a>
          }
          @if (c.email) {
            <a [href]="mailtoHref(c.email)" class="flex items-center gap-3 min-h-12 py-2 text-scoular-green-accessible dark:text-blue-400">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
              <span class="text-base break-all">{{ c.email }}</span>
            </a>
          }
          @if (!addressLine() && !c.phone && !c.email && c.contacts.length === 0) {
            <p class="py-2 text-sm text-gray-500 dark:text-gray-400">No contact details on file.</p>
          }
        </div>
        @if (c.eSignEnabled) { <p class="mt-2"><span class="text-xs rounded-full bg-scoular-cream px-2 py-1 text-gray-700">eSign enrolled</span></p> }
      }
    </section>
  `,
})
export class ContactCardComponent {
  private readonly notices = inject(NoticeService);

  readonly customer = input.required<CustomerDetail>();
  /** Editing needs the farm record loaded (a save always re-sends total acres). */
  readonly canEdit = input(false);
  readonly saveFn = input.required<SaveFn>();
  /** Another card is being edited: hide Edit so only one card is open at a time (one Save, not two). */
  readonly locked = input(false);
  /** A contact edit is queued on the phone (no signal); the card shows the queued contacts. */
  readonly syncPending = input(false);
  /** Tells the Overview when this card opens or closes its editor. */
  readonly editingChange = output<boolean>();

  protected readonly inputClass = INPUT_CLASS;
  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly showErrors = signal(false);
  protected readonly rows = signal<ContactRow[]>([]);

  constructor() {
    effect(() => this.editingChange.emit(this.editing()));
  }

  /** "Street, City, ST ZIP" — the same text the desktop shows and Maps searches for. */
  protected readonly addressLine = computed(() => {
    const c = this.customer();
    const stateZip = [c.stateProvince, c.postalCode].filter(Boolean).join(' ');
    return [c.addressLine1, c.city, stateZip].filter(Boolean).join(', ');
  });

  protected readonly mapsHref = computed(() => {
    const c = this.customer();
    return mapsAddressHref(c.addressLine1, c.city, c.stateProvince, c.postalCode);
  });

  protected startEdit(): void {
    this.rows.set(this.customer().contacts.map((p) => ({ name: p.name, phone: p.phone ?? '', email: p.email ?? '', isPrimary: p.isPrimary })));
    this.showErrors.set(false);
    this.editing.set(true);
  }

  protected addRow(): void {
    this.rows.update((rows) => [...rows, { name: '', phone: '', email: '', isPrimary: rows.length === 0 }]);
  }

  protected removeRow(index: number): void {
    this.rows.update((rows) => {
      const next = rows.filter((_, i) => i !== index);
      if (next.length > 0 && !next.some((r) => r.isPrimary)) next[0] = { ...next[0], isPrimary: true };
      return next;
    });
  }

  protected makePrimary(index: number): void {
    this.rows.update((rows) => rows.map((r, i) => ({ ...r, isPrimary: i === index })));
  }

  protected patch(index: number, change: Partial<ContactRow>): void {
    this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, ...change } : r)));
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    // A row left completely empty is dropped; a row with a phone or email needs a name.
    const kept = this.rows().filter((r) => r.name.trim() || r.phone.trim() || r.email.trim());
    if (kept.some((r) => !r.name.trim())) { this.showErrors.set(true); return; }
    // Primary first, exactly one, as the desktop orders them.
    const ordered = [...kept].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    if (ordered.length > 0 && !ordered[0].isPrimary) ordered[0] = { ...ordered[0], isPrimary: true };
    const contacts: ContactUpdate[] = ordered.map((r, i) => ({
      name: r.name.trim(),
      phone: r.phone.trim() || null,
      email: r.email.trim() || null,
      isPrimary: i === 0,
    }));
    this.saving.set(true);
    try {
      await this.saveFn()({ contacts });
      this.editing.set(false);
    } catch (error) {
      this.notices.error(saveErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected readonly telHref = telHref;
  protected readonly formatPhone = formatPhone;
  protected readonly mailtoHref = mailtoHref;
}
