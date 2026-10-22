import { Component, computed, input, linkedSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FdCicScore, FdCicScoreState } from '@models';

const COMPONENT_LABELS: { key: keyof NonNullable<FdCicScore['components']>; label: string }[] = [
  { key: 'nFertilizer', label: 'Nitrogen fertilizer' },
  { key: 'directN2o', label: 'Field N₂O, direct' },
  { key: 'indirectN2o', label: 'Field N₂O, indirect' },
  { key: 'onFarmEnergy', label: 'On-farm energy' },
  { key: 'otherChemicals', label: 'Other chemicals' },
  { key: 'ureaLime', label: 'Urea & lime' },
  { key: 'soilCarbon', label: 'Soil carbon (credit)' },
];

/**
 * One field's CI from the USDA FD-CIC calculator on the API: the number, how it compares to the
 * national average, a bar per component, and what each of the field's choices is worth. Shown beside
 * the field form so every change has a visible effect. While a new score is on its way the last one
 * stays up, dimmed, so the number doesn't flicker as the originator types.
 */
@Component({
  selector: 'app-ci-preview-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 space-y-4">
      <div class="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <span>This field's CI</span>
        @if (updating()) { <span class="normal-case font-normal">Updating…</span> }
      </div>

      @if (state()?.status === 'error') {
        <div class="text-sm text-amber-800 dark:text-amber-300">{{ errorMessage() }}</div>
      } @else if (shown(); as s) {
        @if (!s.scorable) {
          <div class="text-sm text-amber-800 dark:text-amber-300">{{ s.unscorableReason }}</div>
          <div class="text-xs text-gray-500 dark:text-gray-400">
            USDA's calculator has no data for this combination, so this field can't get a 45Z score.
          </div>
        } @else {
          <div [class.opacity-60]="updating()">
            <div class="text-3xl font-bold text-gray-900 dark:text-white">{{ s.ci | number:'1.0-0' }}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">g CO₂e per bushel</div>
            <div class="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-medium"
                 [class]="better() ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'">
              {{ better() ? '▼' : '▲' }}{{ changeAbs() | percent:'1.0-0' }}
              {{ better() ? 'lower' : 'higher' }} than national ({{ s.nationalAverage | number:'1.0-0' }})
            </div>
          </div>

          <div class="space-y-1.5" [class.opacity-60]="updating()">
            @for (c of components(); track c.key) {
              <div>
                <div class="flex justify-between text-xs text-gray-600 dark:text-gray-300">
                  <span>{{ c.label }}</span>
                  <span class="tabular-nums">{{ c.value | number:'1.0-0' }}</span>
                </div>
                <div class="h-2 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div class="h-full rounded" [style.width.%]="barWidth(c.value)"
                       [class]="c.value < 0 ? 'bg-green-600' : 'bg-scoular-green-accessible'"></div>
                </div>
              </div>
            }
          </div>

          @if (s.effects.length > 0) {
            <div [class.opacity-60]="updating()">
              <div class="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">What's moving the score</div>
              <ul class="space-y-1 text-sm">
                @for (e of s.effects; track e.label) {
                  <li class="flex justify-between gap-2">
                    <span class="text-gray-700 dark:text-gray-300">{{ e.label }}</span>
                    <span class="tabular-nums font-medium" [class]="e.delta < 0 ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'">
                      {{ e.delta < 0 ? '−' : '+' }}{{ (e.delta < 0 ? -e.delta : e.delta) | number:'1.0-0' }}
                    </span>
                  </li>
                }
              </ul>
            </div>
          }
          <div class="text-xs text-gray-500 dark:text-gray-400">
            Based on {{ s.yieldForCi | number:'1.0-0' }} bu/ac{{ s.projected ? ', the expected yield until the actual yield is in' : '' }}.
          </div>
        }
        <div class="text-[11px] text-gray-500 dark:text-gray-400">
          {{ s.label }}@if (s.mlra) { · MLRA {{ s.mlra }}}
        </div>
      } @else if (state()?.status === 'loading') {
        <div class="text-sm text-gray-600 dark:text-gray-300">Calculating with the USDA FD-CIC…</div>
      } @else {
        <div class="text-sm text-gray-600 dark:text-gray-300">
          Fill in the highlighted items to see this field's score.
          @if (missing().length > 0) {
            <ul class="mt-2 list-disc pl-5 text-amber-700 dark:text-amber-400">
              @for (m of missing(); track m) { <li>{{ m }}</li> }
            </ul>
          }
        </div>
      }
    </div>
  `,
})
export class CiPreviewPanelComponent {
  /** The field's score from the API, or null while it can't be requested (see `missing`). */
  readonly state = input<FdCicScoreState | null>(null);
  readonly missing = input<string[]>([]);

  /** The latest finished score, kept on screen while the next one is calculated. */
  readonly shown = linkedSignal<FdCicScoreState | null, FdCicScore | null>({
    source: this.state,
    computation: (state, previous) =>
      state?.status === 'done' ? state.score : state?.status === 'loading' ? (previous?.value ?? null) : null,
  });
  readonly updating = computed(() => this.state()?.status === 'loading' && this.shown() !== null);
  readonly errorMessage = computed(() => {
    const s = this.state();
    return s?.status === 'error' ? s.message : '';
  });
  readonly better = computed(() => (this.shown()?.changeFraction ?? 0) <= 0);
  readonly changeAbs = computed(() => Math.abs(this.shown()?.changeFraction ?? 0));
  readonly components = computed(() => {
    const c = this.shown()?.components;
    return c ? COMPONENT_LABELS.map(({ key, label }) => ({ key, label, value: c[key] })) : [];
  });

  private readonly maxComponent = computed(() => Math.max(1, ...this.components().map(c => Math.abs(c.value))));

  barWidth(value: number): number {
    return Math.round((Math.abs(value) / this.maxComponent()) * 100);
  }
}
