import { Injector, afterNextRender } from '@angular/core';

/**
 * Scrolls something that just appeared (an expanded answer, a filtered topic, a troubleshooter
 * result) into view once Angular has rendered it.
 *
 * Help content often opens below where the user is looking. Without this, the change happens off
 * screen and reads as "nothing happened" (Stacey, QA feedback 2026-10-20). Smooth by default; instant
 * for anyone who has asked their system for reduced motion.
 */
export function revealAfterRender(injector: Injector, find: () => Element | null | undefined, block: ScrollLogicalPosition = 'nearest'): void {
  afterNextRender(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    find()?.scrollIntoView?.({ block, behavior: reduce ? 'auto' : 'smooth' });
  }, { injector });
}
