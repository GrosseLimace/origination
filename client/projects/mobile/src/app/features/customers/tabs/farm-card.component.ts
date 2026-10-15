import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';

import { Commodity, GrainOnFarmItem, newClientRequestId } from '../../../core/api/mobile-api.service';
import { NoticeService } from '../../../core/errors/notice.service';
import { mapsCoordinatesHref } from '../../../core/util/contact-links';
import { formatCoordinates, parseCoordinates } from '../../../core/util/coordinates';
import { formatUpdatedAgo } from '../../../core/util/note-format';
import { FarmRecord, INPUT_CLASS, SaveFn, Site, numberOrNull, saveErrorMessage } from './farm.model';

interface SiteDraft { siteKey: string; name: string; capacity: string; coords: string }
interface GrainDraft { item: GrainOnFarmItem; siteKey: string | null; total: string; sold: string; grade: string; target: string; lastBid: string }
type QuickAdd = { kind: 'site' } | { kind: 'grain'; siteKey: string } | null;

/**
 * Farm details, the way the desktop does it on main (edit-customer-dialog, 2026-10-09): every bin site has its
 * own grain on farm right under it, one row per commodity per site; grain saved before sites existed shows as
 * "not tied to a bin site" and can be moved onto one.
 *
 * View: acres, then each site (name · capacity · Map) with its grain table and "+ Add grain" under it, then
 * "+ Add bin site". Those quick adds open a small form in place (user 2026-10-14: keep the adds under them).
 * "Edit" in the corner (user 2026-10-14: one edit button) edits what is already there — acres, every site
 * (name, capacity, location with "Use my location"), every grain row, moving unlinked grain — with one Save.
 * Adding stays with the quick adds; they are hidden while editing.
 */
@Component({
  selector: 'mob-farm-card',
  imports: [DecimalPipe, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let f = farm();
    <section class="mob-card" aria-labelledby="ov-farm">
      <!-- Card #643: edits attributed and timestamped. The "Updated … by …" line sits under the title inside the
           header row, which is already as tall as the Edit button, so it adds no height (user 2026-10-14). -->
      <div class="flex items-center justify-between gap-2 min-h-11">
        <div class="min-w-0">
          <h2 id="ov-farm" class="mob-label">Farm details</h2>
          @if (syncPending()) {
            <p class="truncate text-xs font-medium text-amber-700 dark:text-amber-400">Saved on this phone · waiting to sync</p>
          } @else if (farm().modifiedAt) {
            <p class="truncate text-xs text-gray-500 dark:text-gray-400">Updated {{ updatedAgo() }}@if (farm().modifiedBy) { by {{ farm().modifiedBy }} }</p>
          }
        </div>
        @if (!editing() && !quickAdd() && !locked()) {
          <button type="button" class="mob-tap -mr-2 shrink-0 px-3 text-sm font-semibold text-scoular-green-accessible dark:text-scoular-green" (click)="startEdit()">Edit</button>
        }
      </div>

      @if (editing()) {
        <!-- ================= Edit everything ================= -->
        <form class="mt-2 space-y-4 pb-16" (submit)="saveEdit($event)" novalidate>
          <label class="block">
            <span class="text-xs text-gray-600 dark:text-gray-300">Total acres</span>
            <div class="relative mt-1">
              <input type="text" inputmode="decimal" autocomplete="off" placeholder="0"
                     class="w-full h-14 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 pl-4 pr-20 text-2xl font-semibold text-gray-900 dark:text-gray-100"
                     [value]="editAcres()" (input)="editAcres.set(text($event))" (blur)="editAcres.set(grouped(editAcres()))">
              <span class="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-base text-gray-500 dark:text-gray-400">acres</span>
            </div>
          </label>

          <div>
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Bin sites</h3>
            <div class="space-y-3">
              @for (s of editSites(); track s.siteKey; let i = $index) {
                <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-semibold">Bin site {{ i + 1 }}</span>
                    <button type="button" class="mob-tap px-2 text-sm text-red-700 dark:text-red-400" (click)="removeSite(i)">Remove site</button>
                  </div>
                  <ng-container [ngTemplateOutlet]="siteFields" [ngTemplateOutletContext]="{ $implicit: s, onPatch: patchSiteFn(i), errorKey: 'edit-' + i }" />

                  @let rows = grainForSite(s.siteKey);
                  @if (rows.length > 0) {
                    <div class="mt-1 pl-3 border-l-2 border-gray-200 dark:border-gray-600 space-y-2">
                      <div class="text-xs font-medium text-gray-600 dark:text-gray-300">Grain on farm — {{ s.name.trim() || 'this site' }}</div>
                      @for (g of rows; track g.idx) {
                        <ng-container [ngTemplateOutlet]="grainFields" [ngTemplateOutletContext]="{ $implicit: g.row, idx: g.idx, movable: false }" />
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </div>

          @let unlinked = grainForSite(null);
          @if (unlinked.length > 0) {
            <div>
              <h3 class="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Grain on farm — not tied to a bin site</h3>
              <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">Saved before grain on farm belonged to a bin site. Move each one to the site it's stored at.</p>
              <div class="space-y-2">
                @for (g of unlinked; track g.idx) {
                  <ng-container [ngTemplateOutlet]="grainFields" [ngTemplateOutletContext]="{ $implicit: g.row, idx: g.idx, movable: true }" />
                }
              </div>
            </div>
          }

          <div class="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 px-4 py-2 flex justify-end gap-2"
               [style.padding-bottom]="'calc(0.5rem + var(--mob-safe-bottom))'">
            <button type="button" class="mob-tap px-4 border border-gray-300 dark:border-gray-600 font-semibold" [disabled]="saving()" (click)="editing.set(false)">Cancel</button>
            <button type="submit" class="mob-tap px-5 bg-scoular-green-accessible text-white font-semibold disabled:opacity-50" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save' }}</button>
          </div>
        </form>
      } @else {
        <!-- ================= View, with quick adds ================= -->
        <!-- Total acres on its own at the top, as a labelled tile (user 2026-10-14: "a little nicer"). -->
        <div class="mt-2 flex items-baseline justify-between gap-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700 px-3 py-2.5">
          <span class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Total acres</span>
          @if (f.acres != null) {
            <span class="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{{ f.acres | number:'1.0-0' }} <span class="text-sm font-medium text-gray-500 dark:text-gray-400">ac</span></span>
          } @else {
            <span class="text-sm text-gray-400 dark:text-gray-500">Not recorded</span>
          }
        </div>

        <h3 class="mt-4 mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Bin sites ({{ f.sites.length }})</h3>
        <div class="divide-y divide-gray-100 dark:divide-gray-700">
          @for (s of f.sites; track s.siteKey) {
            <div class="py-2">
              <!-- Name · capacity · map pin, one line (user 2026-10-14). -->
              <div class="flex flex-wrap items-center gap-x-1.5 text-base">
                <span class="break-words font-semibold text-gray-900 dark:text-gray-100">{{ s.name || 'Unnamed site' }}</span>
                @if (s.capacity != null) { <span class="text-gray-400" aria-hidden="true">·</span><span class="tabular-nums text-gray-600 dark:text-gray-300">{{ s.capacity | number:'1.0-0' }} bu</span> }
                @if (s.latitude != null && s.longitude != null) {
                  <span class="text-gray-400" aria-hidden="true">·</span>
                  <a [href]="mapsCoordinatesHref(s.latitude, s.longitude)" target="_blank" rel="noopener noreferrer"
                     class="inline-flex items-center justify-center h-9 w-9 -my-1.5 rounded-full text-scoular-green-accessible dark:text-blue-400 active:bg-gray-100 dark:active:bg-gray-700"
                     [attr.aria-label]="'Open ' + (s.name || 'bin site') + ' in Maps'" title="Open in Maps"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></a>
                }
              </div>
              @let siteRows = viewGrain(s.siteKey);
              @if (siteRows.length > 0) {
                <ng-container [ngTemplateOutlet]="grainTable" [ngTemplateOutletContext]="{ $implicit: siteRows, title: 'Grain in bin' }" />
              }
              @if (isQuickAdd('grain', s.siteKey)) {
                <ng-container [ngTemplateOutlet]="quickGrainForm" [ngTemplateOutletContext]="{ siteKey: s.siteKey }" />
              } @else if (!quickAdd() && !locked()) {
                <button type="button" class="mob-tap -ml-2 px-2 text-sm font-semibold text-scoular-green-accessible dark:text-scoular-green" (click)="openQuickGrain(s.siteKey)">+ Add grain</button>
              }
            </div>
          } @empty {
            <p class="py-2 text-sm text-gray-500 dark:text-gray-400">No bin sites yet. Add one, then add its grain on farm.</p>
          }
        </div>
        @if (isQuickAdd('site')) {
          <ng-container [ngTemplateOutlet]="quickSiteForm" />
        } @else if (!quickAdd() && !locked()) {
          <div class="mt-1 border-t border-gray-200 dark:border-gray-700 pt-1">
            <button type="button" class="mob-tap -ml-2 px-2 text-sm font-semibold text-scoular-green-accessible dark:text-scoular-green" (click)="openQuickSite()">+ Add bin site</button>
          </div>
        }

        @let loose = viewGrain(null);
        @if (loose.length > 0) {
          <div class="mt-4"><ng-container [ngTemplateOutlet]="grainTable" [ngTemplateOutletContext]="{ $implicit: loose, title: 'Grain not tied to a bin site' }" /></div>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Tap Edit to move these to a bin site.</p>
        }
      }
    </section>

    <!-- "Grain in bin" (user 2026-10-14: neater). A titled box; each crop is its code and total on top, then a
         two-column grid — Sold | Grade, Target | Last bid — labels left, values right-aligned, so every crop
         reads the same way and seven-digit bushels never squeeze the text. -->
    <ng-template #grainTable let-rows let-title="title">
      <div class="mt-2 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
        <div class="bg-gray-50 dark:bg-gray-900/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{{ title }}</div>
        <div class="flex justify-between px-3 pt-2 text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
          <span>Crop</span><span>Total</span>
        </div>
        <ul class="divide-y divide-gray-100 dark:divide-gray-700" role="list">
          @for (g of rows; track $index) {
            <li class="px-3 py-2 text-sm">
              <div class="flex items-baseline justify-between gap-3">
                <span class="font-semibold text-gray-900 dark:text-gray-100">{{ g.commodityCode }}</span>
                <span class="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{{ g.bushelsOnHand != null ? (g.bushelsOnHand | number:'1.0-0') + ' bu' : '—' }}</span>
              </div>
              <dl class="mt-1 grid grid-cols-2 gap-x-6 gap-y-1">
                <div class="flex justify-between gap-2"><dt class="text-gray-500 dark:text-gray-400">Sold</dt><dd class="tabular-nums text-gray-800 dark:text-gray-200">{{ g.bushelsSold != null ? (g.bushelsSold | number:'1.0-0') : '—' }}</dd></div>
                <div class="flex justify-between gap-2"><dt class="text-gray-500 dark:text-gray-400">Grade</dt><dd class="truncate text-gray-800 dark:text-gray-200">{{ g.grade || '—' }}</dd></div>
                <div class="flex justify-between gap-2"><dt class="text-gray-500 dark:text-gray-400">Target</dt><dd class="tabular-nums text-gray-800 dark:text-gray-200">{{ money(g.targetBushels) }}</dd></div>
                <div class="flex justify-between gap-2"><dt class="text-gray-500 dark:text-gray-400">Last bid</dt><dd class="tabular-nums text-gray-800 dark:text-gray-200">{{ g.lastBid != null ? g.lastBid : '—' }}</dd></div>
              </dl>
            </li>
          }
        </ul>
      </div>
    </ng-template>

    <!-- Site fields: Name · Capacity · Location (+ Use my location) -->
    <ng-template #siteFields let-s let-onPatch="onPatch" let-errorKey="errorKey">
      <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Name</span>
        <input type="text" maxlength="100" autocomplete="off" [class]="inputClass" [value]="s.name" (input)="onPatch({ name: text($event) })"
               [attr.aria-invalid]="showErrors() && !s.name.trim()"></label>
      @if (showErrors() && !s.name.trim()) { <p class="text-xs text-red-700 dark:text-red-400">Each bin site needs a name.</p> }
      <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Capacity (bu)</span>
        <input type="text" inputmode="numeric" autocomplete="off" [class]="inputClass" [value]="s.capacity" (input)="onPatch({ capacity: text($event) })" (blur)="onPatch({ capacity: grouped(s.capacity) })"></label>
      <div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-gray-600 dark:text-gray-300" [id]="'loc-' + errorKey">Location (lat, long)</span>
          <!-- On the label line, green, so it reads as the thing to tap (user 2026-10-14). -->
          <button type="button" class="inline-flex items-center gap-1 min-h-9 -my-1 px-2 rounded-md text-sm font-semibold text-scoular-green-accessible dark:text-scoular-green active:bg-gray-100 dark:active:bg-gray-700 disabled:opacity-50"
                  [disabled]="locating() === errorKey" (click)="useMyLocation(errorKey, onPatch)">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>{{ locating() === errorKey ? 'Finding you…' : 'Use my location +' }}
          </button>
        </div>
        <input type="text" autocomplete="off" placeholder="41.2565, -95.9345" [class]="inputClass" [value]="s.coords" (input)="onPatch({ coords: text($event) })"
               [attr.aria-labelledby]="'loc-' + errorKey" [attr.aria-invalid]="showErrors() && coordsInvalid(s.coords)">
      </div>
      @if (showErrors() && coordsInvalid(s.coords)) { <p class="text-xs text-red-700 dark:text-red-400">Use latitude, longitude in North America, e.g. 41.2565, -95.9345.</p> }
    </ng-template>

    <!-- One grain row while editing: commodity fixed, numbers editable; unlinked rows can be moved to a site -->
    <ng-template #grainFields let-g let-idx="idx" let-movable="movable">
      <div class="rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 p-2 space-y-2">
        <div class="flex items-center justify-between">
          <span class="font-semibold text-sm">{{ g.item.commodityCode }}</span>
          <button type="button" class="mob-tap px-2 text-sm text-red-700 dark:text-red-400" (click)="removeGrain(idx)" [attr.aria-label]="'Remove ' + g.item.commodityCode">Remove</button>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Total (bu)</span>
            <input type="text" inputmode="numeric" [class]="inputClass" [value]="g.total" (input)="patchGrain(idx, { total: text($event) })" (blur)="patchGrain(idx, { total: grouped(g.total) })"></label>
          <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Sold (bu)</span>
            <input type="text" inputmode="numeric" [class]="inputClass" [value]="g.sold" (input)="patchGrain(idx, { sold: text($event) })" (blur)="patchGrain(idx, { sold: grouped(g.sold) })"></label>
          <!-- Target and Last bid can be negative (basis): a full keyboard, as on the desktop (phone number pads have no minus key). -->
          <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Target ($/bu)</span>
            <input type="text" [class]="inputClass" [value]="g.target" (input)="patchGrain(idx, { target: text($event) })"></label>
          <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Last bid</span>
            <input type="text" [class]="inputClass" [value]="g.lastBid" (input)="patchGrain(idx, { lastBid: text($event) })"></label>
        </div>
        <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Grade</span>
          <input type="text" maxlength="100" [class]="inputClass" [value]="g.grade" (input)="patchGrain(idx, { grade: text($event) })"></label>
        @if (movable) {
          <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Move to a bin site</span>
            <select [class]="inputClass" (change)="moveGrain(idx, text($event))">
              <option value="">Not tied to a bin site</option>
              @for (t of moveTargets(g.item.commodityCode); track t.siteKey) { <option [value]="t.siteKey">{{ t.name.trim() || 'Unnamed site' }}</option> }
            </select></label>
        }
      </div>
    </ng-template>

    <!-- Quick add: bin site -->
    <ng-template #quickSiteForm>
      <form class="mt-2 space-y-2 rounded-xl border border-gray-200 dark:border-gray-700 p-3" (submit)="saveQuickSite($event)" novalidate>
        <div class="text-sm font-semibold">New bin site</div>
        <ng-container [ngTemplateOutlet]="siteFields" [ngTemplateOutletContext]="{ $implicit: quickSite(), onPatch: patchQuickSite, errorKey: 'quick' }" />
        <ng-container [ngTemplateOutlet]="formActions" />
      </form>
    </ng-template>

    <!-- Quick add: grain at a site -->
    <ng-template #quickGrainForm let-siteKey="siteKey">
      <form class="mt-2 space-y-2 rounded-xl border border-gray-200 dark:border-gray-700 p-3" (submit)="saveQuickGrain($event, siteKey)" novalidate>
        <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Commodity</span>
          <select [class]="inputClass" (change)="patchQuickGrain({ code: text($event) })" [attr.aria-invalid]="showErrors() && !quickGrain().code">
            <option value="" [selected]="!quickGrain().code">Choose…</option>
            @for (o of availableCommodities(siteKey); track o.code) { <option [value]="o.code" [selected]="o.code === quickGrain().code">{{ o.code }}</option> }
          </select></label>
        @if (showErrors() && !quickGrain().code) { <p class="text-xs text-red-700 dark:text-red-400">Choose a commodity.</p> }
        <div class="grid grid-cols-2 gap-2">
          <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Total (bu)</span>
            <input type="text" inputmode="numeric" [class]="inputClass" [value]="quickGrain().total" (input)="patchQuickGrain({ total: text($event) })"></label>
          <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Sold (bu)</span>
            <input type="text" inputmode="numeric" [class]="inputClass" [value]="quickGrain().sold" (input)="patchQuickGrain({ sold: text($event) })"></label>
          <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Target ($/bu)</span>
            <input type="text" [class]="inputClass" [value]="quickGrain().target" (input)="patchQuickGrain({ target: text($event) })"></label>
          <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Last bid</span>
            <input type="text" [class]="inputClass" [value]="quickGrain().lastBid" (input)="patchQuickGrain({ lastBid: text($event) })"></label>
        </div>
        <label class="block"><span class="text-xs text-gray-600 dark:text-gray-300">Grade</span>
          <input type="text" maxlength="100" [class]="inputClass" [value]="quickGrain().grade" (input)="patchQuickGrain({ grade: text($event) })"></label>
        <ng-container [ngTemplateOutlet]="formActions" />
      </form>
    </ng-template>

    <ng-template #formActions>
      <div class="flex justify-end gap-2 pt-1">
        <button type="button" class="mob-tap px-4 border border-gray-300 dark:border-gray-600 font-semibold" [disabled]="saving()" (click)="closeQuickAdd()">Cancel</button>
        <button type="submit" class="mob-tap px-5 bg-scoular-green-accessible text-white font-semibold disabled:opacity-50" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save' }}</button>
      </div>
    </ng-template>
  `,
})
export class FarmCardComponent {
  private readonly notices = inject(NoticeService);

  readonly farm = input.required<FarmRecord>();
  readonly commodities = input<Commodity[]>([]);
  readonly saveFn = input.required<SaveFn>();
  /** Another card is being edited: hide Edit and the quick adds so only one card is open at a time. */
  readonly locked = input(false);
  /** An edit is queued on the phone (no signal); the card shows the queued values. */
  readonly syncPending = input(false);
  /** Tells the Overview when this card opens or closes an editor (Edit or a quick add). */
  readonly editingChange = output<boolean>();

  constructor() {
    effect(() => this.editingChange.emit(this.editing() || this.quickAdd() !== null));
  }

  protected readonly inputClass = INPUT_CLASS;
  protected readonly saving = signal(false);
  protected readonly showErrors = signal(false);
  protected readonly locating = signal<string | null>(null);

  // ---- view helpers -----------------------------------------------------------------------------
  /** "today" / "yesterday" / "3 days ago" / "Sep 1, 2026" for the Updated line. */
  protected readonly updatedAgo = computed(() => {
    const at = this.farm().modifiedAt;
    return at ? formatUpdatedAgo(at) : '';
  });


  /** Grain at a site (or with no / an unknown site when siteKey is null), as read. */
  protected viewGrain(siteKey: string | null): GrainOnFarmItem[] {
    const keys = new Set(this.farm().sites.map((s) => s.siteKey));
    return this.farm().grain.filter((g) => (siteKey === null ? !g.binSiteKey || !keys.has(g.binSiteKey) : g.binSiteKey === siteKey));
  }

  /** Target is $/bu and may be negative (a basis): "-$0.35", like the desktop. */
  protected money(value: number | null | undefined): string {
    if (value == null) return '—';
    const abs = Math.abs(value).toFixed(2);
    return value < 0 ? `-$${abs}` : `$${abs}`;
  }

  // ---- quick add (view mode) --------------------------------------------------------------------
  protected readonly quickAdd = signal<QuickAdd>(null);
  protected readonly quickSite = signal<SiteDraft>({ siteKey: '', name: '', capacity: '', coords: '' });
  protected readonly quickGrain = signal({ code: '', total: '', sold: '', grade: '', target: '', lastBid: '' });

  protected isQuickAdd(kind: 'site' | 'grain', siteKey?: string): boolean {
    const q = this.quickAdd();
    return !!q && q.kind === kind && (kind === 'site' || (q as { siteKey: string }).siteKey === siteKey);
  }

  protected openQuickSite(): void {
    this.quickSite.set({ siteKey: newClientRequestId(), name: '', capacity: '', coords: '' });
    this.showErrors.set(false);
    this.quickAdd.set({ kind: 'site' });
  }

  protected openQuickGrain(siteKey: string): void {
    this.quickGrain.set({ code: '', total: '', sold: '', grade: '', target: '', lastBid: '' });
    this.showErrors.set(false);
    this.quickAdd.set({ kind: 'grain', siteKey });
  }

  protected closeQuickAdd(): void {
    this.quickAdd.set(null);
    this.showErrors.set(false);
  }

  protected readonly patchQuickSite = (change: Partial<SiteDraft>): void => this.quickSite.update((s) => ({ ...s, ...change }));

  protected patchQuickGrain(change: Partial<ReturnType<typeof this.quickGrain>>): void {
    this.quickGrain.update((g) => ({ ...g, ...change }));
  }

  protected async saveQuickSite(event: Event): Promise<void> {
    event.preventDefault();
    const draft = this.quickSite();
    if (!draft.name.trim() || this.coordsInvalid(draft.coords)) { this.showErrors.set(true); return; }
    await this.run({ sites: [...this.farm().sites, toSite(draft)] }, () => this.closeQuickAdd());
  }

  protected async saveQuickGrain(event: Event, siteKey: string): Promise<void> {
    event.preventDefault();
    const d = this.quickGrain();
    if (!d.code) { this.showErrors.set(true); return; }
    const row: GrainOnFarmItem = {
      binSiteKey: siteKey,
      commodityCode: d.code,
      bushelsOnHand: numberOrNull(d.total),
      bushelsSold: numberOrNull(d.sold),
      grade: d.grade.trim() || null,
      targetBushels: numberOrNull(d.target),
      lastBid: numberOrNull(d.lastBid),
    };
    await this.run({ grain: [...this.farm().grain, row] }, () => this.closeQuickAdd());
  }

  /** The trade unit's commodities not already at this site (one row per commodity per site, as on the desktop). */
  protected availableCommodities(siteKey: string): Commodity[] {
    const taken = new Set(this.farm().grain.filter((g) => g.binSiteKey === siteKey).map((g) => g.commodityCode));
    return this.commodities().filter((c) => !taken.has(c.code));
  }

  // ---- edit everything --------------------------------------------------------------------------
  protected readonly editing = signal(false);
  protected readonly editAcres = signal('');
  protected readonly editSites = signal<SiteDraft[]>([]);
  protected readonly editGrain = signal<GrainDraft[]>([]);

  protected startEdit(): void {
    const f = this.farm();
    this.editAcres.set(f.acres != null ? this.grouped(String(f.acres)) : '');
    this.editSites.set(f.sites.map((s) => ({
      siteKey: s.siteKey,
      name: s.name ?? '',
      capacity: s.capacity != null ? this.grouped(String(s.capacity)) : '',
      coords: formatCoordinates(s.latitude, s.longitude),
    })));
    const keys = new Set(f.sites.map((s) => s.siteKey));
    this.editGrain.set(f.grain.map((g) => ({
      item: g,
      siteKey: g.binSiteKey && keys.has(g.binSiteKey) ? g.binSiteKey : null,
      total: g.bushelsOnHand != null ? this.grouped(String(g.bushelsOnHand)) : '',
      sold: g.bushelsSold != null ? this.grouped(String(g.bushelsSold)) : '',
      grade: g.grade ?? '',
      target: g.targetBushels != null ? String(g.targetBushels) : '',
      lastBid: g.lastBid != null ? String(g.lastBid) : '',
    })));
    this.showErrors.set(false);
    this.editing.set(true);
  }

  /** The grain rows for a site while editing (null = not tied to a site), with their index in editGrain. */
  protected grainForSite(siteKey: string | null): { row: GrainDraft; idx: number }[] {
    return this.editGrain().map((row, idx) => ({ row, idx })).filter((g) => g.row.siteKey === siteKey);
  }

  protected patchSiteFn(index: number): (change: Partial<SiteDraft>) => void {
    return (change) => this.editSites.update((rows) => rows.map((r, i) => (i === index ? { ...r, ...change } : r)));
  }

  /** A removed site's grain stays, not tied to a site (the server would do the same with a dangling key). */
  protected removeSite(index: number): void {
    const key = this.editSites()[index].siteKey;
    this.editSites.update((rows) => rows.filter((_, i) => i !== index));
    this.editGrain.update((rows) => rows.map((g) => (g.siteKey === key ? { ...g, siteKey: null } : g)));
  }

  protected patchGrain(index: number, change: Partial<GrainDraft>): void {
    this.editGrain.update((rows) => rows.map((r, i) => (i === index ? { ...r, ...change } : r)));
  }

  protected removeGrain(index: number): void {
    this.editGrain.update((rows) => rows.filter((_, i) => i !== index));
  }

  /** Sites an unlinked row can move to: named, and without that commodity already. */
  protected moveTargets(code: string): SiteDraft[] {
    return this.editSites().filter((s) => !this.editGrain().some((g) => g.siteKey === s.siteKey && g.item.commodityCode === code));
  }

  protected moveGrain(index: number, siteKey: string): void {
    this.patchGrain(index, { siteKey: siteKey || null });
  }

  protected async saveEdit(event: Event): Promise<void> {
    event.preventDefault();
    const sites = this.editSites();
    if (sites.some((s) => !s.name.trim() || this.coordsInvalid(s.coords))) { this.showErrors.set(true); return; }
    const grain: GrainOnFarmItem[] = this.editGrain().map((g) => ({
      ...g.item, // keeps anything the phone does not edit
      binSiteKey: g.siteKey,
      bushelsOnHand: numberOrNull(g.total),
      bushelsSold: numberOrNull(g.sold),
      grade: g.grade.trim() || null,
      targetBushels: numberOrNull(g.target),
      lastBid: numberOrNull(g.lastBid),
    }));
    await this.run({ acres: numberOrNull(this.editAcres()), sites: sites.map(toSite), grain }, () => this.editing.set(false));
  }

  // ---- shared -----------------------------------------------------------------------------------
  protected coordsInvalid(text: string): boolean {
    return parseCoordinates(text) === 'invalid';
  }

  /** Fill a site's location from the phone's GPS, standing at the bin site. */
  protected useMyLocation(key: string, onPatch: (change: Partial<SiteDraft>) => void): void {
    if (!('geolocation' in navigator)) { this.notices.error("This phone can't share its location."); return; }
    this.locating.set(key);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.locating.set(null);
        onPatch({ coords: `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}` });
      },
      () => {
        this.locating.set(null);
        this.notices.error("Couldn't get your location. Check that location access is allowed for this site.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  /** "1200" → "1,200" on blur, like the desktop's grouped inputs; anything unreadable is left as typed. */
  protected grouped(value: string): string {
    const n = numberOrNull(value);
    return n == null ? value : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  private async run(change: Parameters<SaveFn>[0], onDone: () => void): Promise<void> {
    this.saving.set(true);
    try {
      await this.saveFn()(change);
      this.showErrors.set(false);
      onDone();
    } catch (error) {
      // Stay open with the edits; tell the user why (no connection, changed on the desktop, etc.).
      this.notices.error(saveErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected readonly mapsCoordinatesHref = mapsCoordinatesHref;
}

function toSite(d: SiteDraft): Site {
  const c = parseCoordinates(d.coords);
  const coords = c && c !== 'invalid' ? c : null;
  return {
    siteKey: d.siteKey,
    name: d.name.trim(),
    capacity: numberOrNull(d.capacity),
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
  };
}
