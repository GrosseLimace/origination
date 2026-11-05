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
  templateUrl: './ci-preview-panel.component.html',
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
