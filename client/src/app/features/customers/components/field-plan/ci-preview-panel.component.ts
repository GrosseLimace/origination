import { Component, computed, input, linkedSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FdCicScore, FdCicScoreState } from '@models';

/**
 * One field's CI from the USDA FD-CIC calculator on the API: the raw number (never a comparison with the
 * national average, which would suggest it decides whether a field qualifies), the part of each component
 * this field's inputs change (with which inputs), the fixed USDA figures apart from them so nobody thinks
 * an input could lower those, and what each of the field's choices is worth. Shown beside
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
          </div>

          <div class="space-y-1.5" [class.opacity-60]="updating()">
            <div class="text-xs font-semibold text-gray-700 dark:text-gray-200">Changed by this field's inputs</div>
            @for (c of adjustable(); track c.key) {
              <div>
                <div class="flex justify-between gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <span>{{ c.label }}</span>
                  <span class="tabular-nums">
                    @if (moved().get(c.key); as d) {
                      <span class="mr-1 rounded bg-gray-200 dark:bg-gray-700 px-1 font-medium text-gray-800 dark:text-gray-100" title="Change from your last edit">{{ d < 0 ? '−' : '+' }}{{ (d < 0 ? -d : d) | number:'1.0-0' }}</span>
                    }
                    {{ c.value | number:'1.0-0' }}
                  </span>
                </div>
                <div class="h-2 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div class="h-full rounded" [style.width.%]="barWidth(c.value)"
                       [class]="c.value < 0 ? 'bg-green-600' : 'bg-scoular-green-accessible'"></div>
                </div>
                <div class="text-[11px] text-gray-500 dark:text-gray-400">{{ c.drivers }}</div>
              </div>
            }
          </div>

          @if (fixedParts().length) {
            <div class="space-y-1" [class.opacity-60]="updating()">
              <div class="text-xs font-semibold text-gray-500 dark:text-gray-400">USDA defaults (no input changes these)</div>
              @for (f of fixedParts(); track f.label) {
                <div class="flex justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <span>🔒 {{ f.label }}</span>
                  <span class="tabular-nums">{{ f.value | number:'1.0-0' }}</span>
                </div>
              }
              <div class="text-[11px] text-gray-500 dark:text-gray-400">National figures in {{ s.label }}. The calculator has no input for these.</div>
            </div>
          }

          @if (s.effects.length > 0) {
            <div [class.opacity-60]="updating()">
              <div class="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">What's moving the score</div>
              <ul class="space-y-1 text-sm">
                @for (e of s.effects; track e.label) {
                  <li>
                    <div class="flex justify-between gap-2">
                      <span class="text-gray-700 dark:text-gray-300">{{ e.label }}</span>
                      <span class="tabular-nums font-medium" [class]="e.delta < 0 ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'">
                        {{ e.delta < 0 ? '−' : '+' }}{{ (e.delta < 0 ? -e.delta : e.delta) | number:'1.0-0' }}
                      </span>
                    </div>
                    @if (e.components.length) {
                      <div class="text-[11px] text-gray-500 dark:text-gray-400">
                        @for (c of e.components; track c.key; let last = $last) {
                          {{ c.label }} {{ c.delta < 0 ? '−' : '+' }}{{ (c.delta < 0 ? -c.delta : c.delta) | number:'1.0-0' }}@if (!last) { · }
                        }
                      </div>
                    }
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
  /** The score shown and the one before it, so the rows an edit moved can be marked. */
  private readonly history = linkedSignal<FdCicScore | null, { current: FdCicScore | null; prior: FdCicScore | null }>({
    source: this.shown,
    computation: (score, previous) => {
      const p = previous?.value;
      if (!score) return { current: null, prior: null };
      return p?.current === score ? p : { current: score, prior: p?.current ?? null };
    },
  });

  /**
   * How much each adjustable part moved since the previous score (1 g/bu or more), until the next one.
   * The fixed USDA parts never move, so they never get a mark.
   */
  readonly moved = computed(() => {
    const { current, prior } = this.history();
    const marks = new Map<string, number>();
    if (!current || !prior) return marks;
    const before = new Map(prior.breakdown.map(b => [b.key, b.total - b.fixed]));
    for (const b of current.breakdown) {
      const d = b.total - b.fixed - (before.get(b.key) ?? 0);
      if (b.drivers.length && Math.abs(d) >= 1) marks.set(b.key, d);
    }
    return marks;
  });

  /** Each component's part that the field's inputs change, with the inputs that change it. */
  readonly adjustable = computed(() => (this.shown()?.breakdown ?? [])
    .filter(b => b.drivers.length > 0)
    .map(b => ({ key: b.key, label: b.label, value: b.total - b.fixed, drivers: b.drivers.join(', ') })));
  /** The fixed USDA parts (other chemicals, lime, other on-farm energy, soybean N fixation): never adjustable. */
  readonly fixedParts = computed(() => (this.shown()?.breakdown ?? [])
    .filter(b => b.fixed !== 0 && b.fixedLabel)
    .map(b => ({ label: b.fixedLabel!, value: b.fixed })));

  private readonly maxComponent = computed(() => Math.max(1, ...this.adjustable().map(c => Math.abs(c.value))));

  barWidth(value: number): number {
    return Math.round((Math.abs(value) / this.maxComponent()) * 100);
  }
}
