import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, resource, signal } from '@angular/core';

import {
  Commodity, MobileApiService, PlantingIntention, PlantingIntentionCreate, PlantingIntentionUpdate, newClientRequestId,
} from '../../../core/api/mobile-api.service';
import { NoticeService } from '../../../core/errors/notice.service';
import { SyncQueueService } from '../../../core/offline/sync-queue.service';
import { SessionStore } from '../../../core/state/session.store';
import { SpinnerComponent } from '../../../core/ui/spinner.component';
import { saveErrorMessage } from './farm.model';

const FIELD =
  'w-full h-11 rounded-lg border px-3 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 placeholder:text-gray-400 dark:placeholder:text-gray-500';

const READONLY_FIELD =
  'w-full h-11 rounded-lg border px-3 flex items-center truncate bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700';

/** The desktop's choices; '' = none. */
const TYPES = ['Irrigated', 'Dryland', 'Double Crop'] as const;

interface Draft { crop: string; type: string; acres: string; year: string; tradeUnit: string }

/** A card: the saved intention, or one still on the phone (queued add, or saved one with a queued edit). */
type Row = PlantingIntention & { pending?: boolean };

/**
 * Card #647 — planting intentions as cards (crop, acres, crop year; no calendar date). "Create new" at the top;
 * each card has Edit (user 2026-10-15), which turns it into a form for crop, acres and crop year with Save / Cancel.
 * "Crop year" as on the desktop. A failed save keeps what was typed and says why.
 * Type (Irrigated / Dryland / Double Crop, optional) on both forms, shown before the crop like the desktop
 * ("Irrigated Corn"). New intentions go to a trade unit picked at sign-in: one is used as-is, several must be
 * chosen (user 2026-10-15). Edit keeps the trade unit. No delete on mobile for now (user 2026-10-15).
 * Without signal, adds and edits are kept on the phone (SyncQueueService, Burdi's pattern) and shown on their
 * cards as "Waiting to sync" until they are sent.
 */
@Component({
  selector: 'mob-planting-tab',
  imports: [SpinnerComponent, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="mob-card space-y-2" (submit)="add($event)" novalidate>
      <span class="mob-label">Create new</span>
      <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Crop</span>
        <select class="mt-1 ${FIELD}" (change)="patchNew({ crop: text($event) })" aria-label="Crop">
          <option value="" [selected]="!newDraft().crop" disabled>Choose a crop…</option>
          @for (c of commodities.value() ?? []; track c.code) { <option [value]="c.code" [selected]="c.code === newDraft().crop">{{ c.name }}</option> }
        </select></label>
      <div class="grid grid-cols-2 gap-2">
        <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Type <span class="text-gray-400 dark:text-gray-500">(optional)</span></span>
          <select class="mt-1 ${FIELD}" (change)="patchNew({ type: text($event) })" aria-label="Type">
            <option value="" [selected]="!newDraft().type">None</option>
            @for (t of types; track t) { <option [value]="t" [selected]="t === newDraft().type">{{ t }}</option> }
          </select></label>
        <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Acres</span>
          <input type="number" inputmode="numeric" min="0" max="10000000" class="mt-1 ${FIELD}" placeholder="e.g., 1,200"
                 [value]="newDraft().acres" (input)="patchNew({ acres: text($event) })"></label>
        <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Crop year</span>
          <input type="number" inputmode="numeric" min="2000" max="2100" class="mt-1 ${FIELD}"
                 [value]="newDraft().year" (input)="patchNew({ year: text($event) })"></label>
        @if (tradeUnitOptions().length > 1) {
          <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Trade unit</span>
            <select class="mt-1 ${FIELD}" (change)="patchNew({ tradeUnit: text($event) })" aria-label="Trade unit">
              <option value="" [selected]="!newDraft().tradeUnit" disabled>Choose…</option>
              @for (tu of tradeUnitOptions(); track tu) { <option [value]="tu" [selected]="tu === newDraft().tradeUnit">{{ tradeUnitLabel(tu) }}</option> }
            </select></label>
        } @else if (tradeUnitOptions().length === 1) {
          <div><span class="text-xs text-gray-600 dark:text-gray-300">Trade unit</span>
            <div class="mt-1 ${READONLY_FIELD}">{{ tradeUnitLabel(tradeUnitOptions()[0]!) }}</div></div>
        }
      </div>
      <button type="submit" class="mob-tap w-full bg-scoular-green-accessible text-white font-semibold disabled:opacity-50"
              [disabled]="!validNew() || saving()">
        {{ saving() && editing() === null ? 'Saving…' : 'Add planting intention' }}
      </button>
    </form>

    @if (intentions.isLoading() && !intentions.hasValue()) {
      <mob-spinner label="Loading planting intentions…" />
    } @else if (intentions.hasValue()) {
      <ul class="mt-3 space-y-2" role="list">
        @for (p of rows(); track p.id) {
          <li class="mob-card">
            @if (editing() === p.id) {
              <!-- Edit in place: crop, acres, crop year -->
              <form class="space-y-2" (submit)="saveEdit($event, p)" novalidate>
                <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Crop</span>
                  <select class="mt-1 ${FIELD}" (change)="patchEdit({ crop: text($event) })" aria-label="Crop">
                    @for (c of cropOptions(editDraft().crop); track c.code) { <option [value]="c.code" [selected]="c.code === editDraft().crop">{{ c.name }}</option> }
                  </select></label>
                <div class="grid grid-cols-2 gap-2">
                  <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Type <span class="text-gray-400 dark:text-gray-500">(optional)</span></span>
                    <select class="mt-1 ${FIELD}" (change)="patchEdit({ type: text($event) })" aria-label="Type">
                      <option value="" [selected]="!editDraft().type">None</option>
                      @for (t of typeOptions(editDraft().type); track t) { <option [value]="t" [selected]="t === editDraft().type">{{ t }}</option> }
                    </select></label>
                  <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Acres</span>
                    <input type="number" inputmode="numeric" min="0" max="10000000" class="mt-1 ${FIELD}"
                           [value]="editDraft().acres" (input)="patchEdit({ acres: text($event) })"></label>
                  <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Crop year</span>
                    <input type="number" inputmode="numeric" min="2000" max="2100" class="mt-1 ${FIELD}"
                           [value]="editDraft().year" (input)="patchEdit({ year: text($event) })"></label>
                  <div><span class="text-xs text-gray-600 dark:text-gray-300">Trade unit</span>
                    <div class="mt-1 ${READONLY_FIELD}">{{ tradeUnitLabel(p.tradeUnit) }}</div></div>
                </div>
                <div class="flex justify-end gap-2 pt-1">
                  <button type="button" class="mob-tap px-4 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 font-semibold" [disabled]="saving()" (click)="editing.set(null)">Cancel</button>
                  <button type="submit" class="mob-tap px-5 bg-scoular-green-accessible text-white font-semibold disabled:opacity-50" [disabled]="!valid(editDraft()) || saving()">
                    {{ saving() ? 'Saving…' : 'Save' }}
                  </button>
                </div>
              </form>
            } @else {
              <!-- Edit sits in the corner by the crop name (like Farm details), so big acre numbers get the full width -->
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="font-semibold text-gray-900 dark:text-white">{{ cropLabel(p) }}</div>
                  @if (p.pending) { <div class="text-xs font-medium text-amber-700 dark:text-amber-400">Saved on this phone · waiting to sync</div> }
                </div>
                @if (p.id > 0) {
                <button type="button" class="-mt-1 -mr-1 px-2 py-1 text-sm font-semibold text-scoular-green-accessible dark:text-scoular-green disabled:opacity-50"
                        [disabled]="editing() !== null" (click)="startEdit(p)" [attr.aria-label]="'Edit ' + cropLabel(p) + ' ' + p.plantingYear">Edit</button>
                }
              </div>
              <div class="mt-1 flex items-baseline justify-between gap-3">
                <div class="text-sm text-gray-500 dark:text-gray-400">Crop year {{ p.plantingYear }} · TU {{ p.tradeUnit }}</div>
                <div class="shrink-0 whitespace-nowrap"><span class="text-xl font-bold tabular-nums text-gray-900 dark:text-white">{{ p.acres | number }}</span> <span class="text-sm text-gray-500 dark:text-gray-400">ac</span></div>
              </div>
            }
          </li>
        }
      </ul>
      @if (rows().length === 0) { <p class="mt-6 text-center text-sm text-gray-400 dark:text-gray-500">No planting intentions recorded.</p> }
    } @else if (intentions.error()) {
      <p class="mt-3 text-sm text-red-700 dark:text-red-400" role="alert">Couldn't load planting intentions.</p>
    }
  `,
})
export class PlantingTab {
  private readonly api = inject(MobileApiService);
  private readonly notices = inject(NoticeService);
  private readonly session = inject(SessionStore);
  private readonly queue = inject(SyncQueueService);
  readonly customerId = input.required<number>();

  protected readonly types = TYPES;
  protected readonly newDraft = signal<Draft>({ crop: '', type: '', acres: '', year: String(new Date().getFullYear() + 1), tradeUnit: '' });
  protected readonly editDraft = signal<Draft>({ crop: '', type: '', acres: '', year: '', tradeUnit: '' });

  /** Trade units picked at sign-in. None (e.g. opened from a link) → the server picks the producer's first entitled one. */
  protected readonly tradeUnitOptions = computed(() => this.session.selectedTradeUnits());
  protected readonly saving = signal(false);
  protected readonly editing = signal<number | null>(null);

  protected readonly commodities = resource<Commodity[], void>({ loader: () => this.api.getPlantingCommodities() });
  protected readonly intentions = resource<PlantingIntention[], number>({
    params: () => this.customerId(),
    loader: ({ params }) => this.api.getPlantingIntentions(params),
  });

  /**
   * Saved intentions with queued edits applied, then queued adds (negative ids: they have no server id yet, so no
   * Edit). Refused writes are left out here; the sync issues box shows them.
   */
  protected readonly rows = computed<Row[]>(() => {
    const saved = this.intentions.hasValue() ? this.intentions.value() : [];
    const queued = this.queue.items().filter((i) => i.customerId === this.customerId() && i.status !== 'error');
    const rows: Row[] = saved.map((p) => {
      const edit = queued.find((i) => i.kind === 'planting-update' && i.intentionId === p.id);
      if (!edit) return p;
      const b = edit.body as PlantingIntentionUpdate;
      return {
        ...p,
        crop: b.crop || p.crop,
        acres: b.acres,
        plantingYear: b.plantingYear ?? p.plantingYear,
        type: b.type === undefined ? p.type : (b.type || null),
        pending: true,
      };
    });
    for (const add of queued.filter((i) => i.kind === 'planting-create')) {
      const b = add.body as PlantingIntentionCreate;
      rows.unshift({
        id: -(add.id ?? 0), customerId: this.customerId(), crop: b.crop, type: b.type ?? null, acres: b.acres,
        plantingYear: b.plantingYear, tradeUnit: b.tradeUnit ?? '', pending: true,
      });
    }
    return rows;
  });

  constructor() {
    // The queue delivered one of this producer's planting changes: show the saved version.
    effect(() => {
      const synced = this.queue.synced();
      if (synced && synced.customerId === this.customerId() && synced.kind.startsWith('planting-')) this.intentions.reload();
    });
  }

  protected cropName(code: string): string {
    return this.commodities.value()?.find((c) => c.code === code)?.name ?? code;
  }

  /** "[Type ]Crop", as the desktop labels a row (e.g. "Irrigated Yellow Corn"). */
  protected cropLabel(p: PlantingIntention): string {
    return `${p.type ? p.type + ' ' : ''}${this.cropName(p.crop)}`;
  }

  protected tradeUnitLabel(code: string | null | undefined): string {
    if (!code) return '—';
    const name = this.session.tradeUnitName(code);
    return name && name !== code ? `${code} - ${name}` : code;
  }

  /** The three types, plus an older free-text type on the row so editing doesn't silently drop it. */
  protected typeOptions(current: string): readonly string[] {
    return current && !TYPES.some((t) => t === current) ? [current, ...TYPES] : TYPES;
  }

  /** With several trade units picked, one must be chosen before adding. */
  protected validNew(): boolean {
    const d = this.newDraft();
    const options = this.tradeUnitOptions();
    return this.valid(d) && (options.length <= 1 || options.includes(d.tradeUnit));
  }

  /** The trade unit's crops, plus the intention's own code if it is no longer in the list (so it is not lost). */
  protected cropOptions(current: string): Commodity[] {
    const list = this.commodities.value() ?? [];
    return current && !list.some((c) => c.code === current) ? [{ code: current, name: current }, ...list] : list;
  }

  protected valid(d: Draft): boolean {
    const acres = Number(d.acres);
    const year = Number(d.year);
    return !!d.crop && d.acres.trim() !== '' && Number.isFinite(acres) && acres >= 0 && Number.isInteger(year) && year >= 2000 && year <= 2100;
  }

  protected patchNew(change: Partial<Draft>): void {
    this.newDraft.update((d) => ({ ...d, ...change }));
  }

  protected patchEdit(change: Partial<Draft>): void {
    this.editDraft.update((d) => ({ ...d, ...change }));
  }

  protected async add(event: Event): Promise<void> {
    event.preventDefault();
    const d = this.newDraft();
    if (!this.valid(d)) return;
    this.saving.set(true);
    try {
      const result = await this.queue.submit({
        kind: 'planting-create',
        customerId: this.customerId(),
        body: {
          clientRequestId: newClientRequestId(),
          crop: d.crop,
          acres: Number(d.acres),
          plantingYear: Number(d.year),
          type: d.type || null,
          tradeUnit: this.chosenTradeUnit(d),
        },
      });
      this.newDraft.update((x) => ({ ...x, acres: '' }));
      if (result === 'sent') {
        this.intentions.reload();
        this.notices.info('Planting intention added.');
      } else {
        this.notices.info('Saved on this phone. It will be sent when you are back online.');
      }
    } catch (error) {
      this.notices.error(saveErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected startEdit(p: PlantingIntention): void {
    this.editDraft.set({ crop: p.crop, type: p.type ?? '', acres: String(p.acres), year: String(p.plantingYear), tradeUnit: p.tradeUnit ?? '' });
    this.editing.set(p.id);
  }

  protected async saveEdit(event: Event, p: Row): Promise<void> {
    event.preventDefault();
    const d = this.editDraft();
    if (!this.valid(d)) return;
    this.saving.set(true);
    try {
      const result = await this.queue.submit({
        kind: 'planting-update',
        customerId: this.customerId(),
        intentionId: p.id,
        body: {
          clientRequestId: newClientRequestId(),
          crop: d.crop,
          acres: Number(d.acres),
          plantingYear: Number(d.year),
          type: d.type,
          expectedModifiedAt: p.modifiedAt ?? null,
        },
      });
      this.editing.set(null);
      if (result === 'sent') {
        this.intentions.reload();
        this.notices.info('Planting intention saved.');
      } else {
        this.notices.info('Saved on this phone. It will be sent when you are back online.');
      }
    } catch (error) {
      // Stay open with the edits; say why (no connection, changed on the desktop, duplicate, …).
      this.notices.error(saveErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  private chosenTradeUnit(d: Draft): string | null {
    const options = this.tradeUnitOptions();
    if (options.length === 1) return options[0]!;
    return options.includes(d.tradeUnit) ? d.tradeUnit : null;
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
