import { Directive, ElementRef, DestroyRef, afterNextRender, inject, output } from '@angular/core';

/**
 * Reports whether the host element's content is taller than its (line-clamped) box — i.e.
 * whether it is actually being truncated with an ellipsis. Emits on first render and whenever
 * the element resizes (column reflow, clamp toggled, window resize), so a "Show more" toggle can
 * be shown based on real overflow instead of guessing by character count.
 *
 * Usage:
 *   <p class="line-clamp-4" appClampOverflow (clampOverflow)="setOverflow(id, $event)"> ... </p>
 */
@Directive({
  selector: '[appClampOverflow]',
  standalone: true,
})
export class ClampOverflowDirective {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  /** True when scrollHeight exceeds clientHeight (content clipped by the clamp). */
  readonly clampOverflow = output<boolean>();

  private ro?: ResizeObserver;
  private last: boolean | null = null;

  constructor() {
    afterNextRender(() => {
      this.measure();
      // Re-measure on any size change: content edits, column reflow, or the clamp class
      // toggling on expand/collapse (which changes the element's own height).
      this.ro = new ResizeObserver(() => this.measure());
      this.ro.observe(this.el.nativeElement);
      this.destroyRef.onDestroy(() => this.ro?.disconnect());
    });
  }

  private measure(): void {
    const e = this.el.nativeElement;
    // 1px tolerance guards against sub-pixel rounding reporting a false overflow.
    const overflowing = e.scrollHeight - e.clientHeight > 1;
    if (overflowing !== this.last) {
      this.last = overflowing;
      this.clampOverflow.emit(overflowing);
    }
  }
}
