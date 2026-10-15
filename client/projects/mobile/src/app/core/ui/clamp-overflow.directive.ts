import { DestroyRef, Directive, ElementRef, afterNextRender, inject, output } from '@angular/core';

/**
 * Reports whether the host's content is taller than its line-clamped box, i.e. really truncated — so
 * "Show more" appears only on notes that are cut off. The desktop's ClampOverflowDirective
 * (client/src/app/shared/directives/clamp-overflow.directive.ts), copied because the mobile app may not
 * import desktop code.
 *
 *   <p class="line-clamp-4" mobClampOverflow (clampOverflow)="setOverflow(id, $event)"> … </p>
 */
@Directive({ selector: '[mobClampOverflow]' })
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
      // Re-measure on any size change: rotation, the clamp toggling on expand/collapse.
      if (typeof ResizeObserver !== 'undefined') {
        this.ro = new ResizeObserver(() => this.measure());
        this.ro.observe(this.el.nativeElement);
        this.destroyRef.onDestroy(() => this.ro?.disconnect());
      }
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
