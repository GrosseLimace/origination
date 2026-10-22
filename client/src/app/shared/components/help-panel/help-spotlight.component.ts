import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';

import { HelpPanelService } from '@core/services/help-panel.service';
import { HelpIconComponent } from '@shared/components/help-icon/help-icon.component';

/**
 * What the tooltip says for each anchor. Every anchor used by help-faq.json needs an entry here and a
 * data-help-anchor attribute in the app; help-faq.drift.spec.ts checks both.
 */
export const HELP_ANCHOR_TIPS: Record<string, string> = {
  'trade-unit-selector': 'Choose your trade group and trade units here. The producer list, Build a List, Actionable Insights and the dashboard all follow this selection.',
  'query-library': 'Pick a query here to start a list, then narrow it with Refine Filters.',
  'set-season-targets': 'Set the expected yield and market share for each crop here.',
  'producer-search': 'Search here. In All Producers mode, a result marked Not added can be opened and added to a trade unit with Edit.'
};

/** How long to wait for an anchor to appear after navigating to its screen. */
const FIND_TIMEOUT_MS = 4000;
const PAD = 6;
const TIP_WIDTH = 300;

interface Box { x: number; y: number; w: number; h: number; }

/**
 * "Show me on screen": dims the page and outlines the real control, with a short tooltip. The panel
 * steps aside to a slim Help tab meanwhile; Got it, Esc or the tab bring it back.
 *
 * It highlights the live element rather than a screenshot, so it can't go out of date — if the
 * control is renamed or removed, the drift test fails instead.
 */
@Component({
  selector: 'app-help-spotlight',
  standalone: true,
  imports: [HelpIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (panel.spotlight(); as anchor) {
      @if (box(); as b) {
        <!-- The outline's huge spread shadow is the dimmed backdrop, leaving the control itself clear. -->
        <div class="fixed z-[70] rounded-lg ring-2 ring-scoular-blue pointer-events-none motion-safe:transition-all"
          [style.left.px]="b.x" [style.top.px]="b.y" [style.width.px]="b.w" [style.height.px]="b.h"
          style="box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.55)"></div>
        <div role="dialog" aria-modal="true" aria-labelledby="help-spotlight-tip"
          class="fixed z-[71] w-[300px] rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xl p-3"
          [style.left.px]="tipX()" [style.top.px]="tipY()">
          <p id="help-spotlight-tip" class="text-sm text-gray-800 dark:text-gray-200">{{ tip(anchor) }}</p>
          <button type="button" (click)="panel.endSpotlight()" autofocus
            class="mt-2 h-8 px-3 rounded-md text-sm font-medium text-white bg-scoular-blue-medium hover:bg-scoular-blue-dark dark:bg-[#006BA6] dark:hover:bg-scoular-blue-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scoular-blue focus-visible:ring-offset-1">
            Got it
          </button>
        </div>
      }
      <!-- The panel, stepped aside -->
      <button type="button" (click)="panel.endSpotlight()" aria-label="Back to Help"
        class="fixed z-[71] right-0 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 px-2 py-3 rounded-l-lg text-white bg-scoular-blue-medium dark:bg-[#006BA6] shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scoular-blue">
        <app-help-icon name="chevron-left" />
        <span class="text-xs font-semibold [writing-mode:vertical-rl]">Help</span>
      </button>
    }
  `
})
export class HelpSpotlightComponent {
  readonly panel = inject(HelpPanelService);

  readonly box = signal<Box | null>(null);

  private target: HTMLElement | null = null;
  private findTimer: ReturnType<typeof setInterval> | null = null;
  private readonly reposition = () => this.measure();

  constructor() {
    effect(() => {
      const anchor = this.panel.spotlight();
      untracked(() => this.follow(anchor));
    });

    window.addEventListener('resize', this.reposition);
    window.addEventListener('scroll', this.reposition, true);
    inject(DestroyRef).onDestroy(() => {
      this.stopFinding();
      window.removeEventListener('resize', this.reposition);
      window.removeEventListener('scroll', this.reposition, true);
    });
  }

  tip(anchor: string): string {
    return HELP_ANCHOR_TIPS[anchor] ?? '';
  }

  tipX(): number {
    const b = this.box();
    if (!b) return 0;
    return Math.max(12, Math.min(b.x, window.innerWidth - TIP_WIDTH - 12));
  }

  /** Below the control, or above it when there's no room underneath. */
  tipY(): number {
    const b = this.box();
    if (!b) return 0;
    const below = b.y + b.h + 12;
    return below + 140 < window.innerHeight ? below : Math.max(12, b.y - 152);
  }

  /** Finds the anchor (waiting for it if the screen is still loading) and outlines it. */
  private follow(anchor: string | null): void {
    this.stopFinding();
    this.target = null;
    this.box.set(null);
    if (anchor === null) return;

    const started = Date.now();
    const tryFind = () => {
      const element = visibleAnchor(anchor);
      if (element) {
        this.stopFinding();
        this.target = element;
        element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        this.measure();
      } else if (Date.now() - started > FIND_TIMEOUT_MS) {
        // The control isn't on this screen (a flag is off, or nothing is selected). Return to the
        // panel rather than dimming the page around nothing.
        this.stopFinding();
        this.panel.endSpotlight();
      }
    };
    tryFind();
    if (!this.target) this.findTimer = setInterval(tryFind, 100);
  }

  private measure(): void {
    if (!this.target) return;
    const r = anchorRect(this.target);
    this.box.set({ x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 });
  }

  private stopFinding(): void {
    if (this.findTimer !== null) {
      clearInterval(this.findTimer);
      this.findTimer = null;
    }
  }
}

/** The first element carrying the anchor that is actually laid out (not hidden in a closed dialog). */
function visibleAnchor(anchor: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-help-anchor="${CSS.escape(anchor)}"]`);
  for (const element of Array.from(all)) {
    const r = anchorRect(element);
    if (r.width > 0 && r.height > 0) return element;
  }
  return null;
}

/**
 * The element's box. A component host is display:inline by default and can report an empty box
 * around block children, so fall back to the union of its children rather than restyle the host.
 */
function anchorRect(element: HTMLElement): { left: number; top: number; width: number; height: number } {
  const own = element.getBoundingClientRect();
  if (own.width > 0 && own.height > 0) return own;
  const boxes = Array.from(element.children)
    .map(c => c.getBoundingClientRect())
    .filter(r => r.width > 0 && r.height > 0);
  if (boxes.length === 0) return own;
  const left = Math.min(...boxes.map(r => r.left));
  const top = Math.min(...boxes.map(r => r.top));
  const right = Math.max(...boxes.map(r => r.right));
  const bottom = Math.max(...boxes.map(r => r.bottom));
  return { left, top, width: right - left, height: bottom - top };
}
