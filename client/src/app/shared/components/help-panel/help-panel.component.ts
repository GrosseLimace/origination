import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, afterRenderEffect, computed, effect, inject, signal, untracked, viewChild
} from '@angular/core';
import { Router } from '@angular/router';
import { A11yModule } from '@angular/cdk/a11y';

import { HelpFaq } from '@models';
import { HelpPanelService } from '@core/services/help-panel.service';
import { HelpService } from '@core/services/help.service';
import { HelpIconComponent } from '@shared/components/help-icon/help-icon.component';
import { HelpAnswerCardComponent } from './help-answer-card.component';
import { HelpEscalationComponent } from './help-escalation.component';
import { HelpTroubleshooterComponent } from './help-troubleshooter.component';
import { HelpSpotlightComponent } from './help-spotlight.component';

/** Short screen names for "Suggested for this page". */
const PAGE_LABELS: Record<string, string> = {
  '/': 'Producers',
  '/build-list': 'Build a List',
  '/dashboard': 'Planting dashboard',
  '/insights': 'Actionable Insights',
  '/bid-sheet': 'Bid Sheet',
  '/daily-digest': 'Manage Groups'
};

/**
 * The Help panel from the approved design: a 400px column beside the page on desktop (the page makes
 * room for it), full-screen on a phone. Greeting and page suggestions when empty; otherwise the
 * conversation, newest at the bottom. All state lives in HelpPanelService so it survives navigation.
 */
@Component({
  selector: 'app-help-panel',
  standalone: true,
  imports: [A11yModule, HelpIconComponent, HelpAnswerCardComponent, HelpEscalationComponent, HelpTroubleshooterComponent, HelpSpotlightComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './help-panel.component.html'
})
export class HelpPanelComponent {
  readonly panel = inject(HelpPanelService);
  readonly help = inject(HelpService);
  private readonly router = inject(Router);

  readonly question = signal('');

  private readonly input = viewChild<ElementRef<HTMLInputElement>>('questionInput');
  private readonly body = viewChild<ElementRef<HTMLElement>>('threadBody');

  /** Shown when the panel is open and not stepped aside for a spotlight. */
  readonly visible = computed(() => this.panel.open() && this.panel.spotlight() === null);

  readonly suggestions = computed(() => {
    this.help.content(); // re-run once the content lands
    return this.help.suggestionsFor(this.panel.route());
  });

  private readonly threadLength = computed(() => this.panel.thread().length);

  readonly pageLabel = computed(() => PAGE_LABELS[this.panel.route()] ?? null);

  readonly thread = computed(() =>
    this.panel.thread().map((item, index) => ({
      item,
      index,
      faq: item.kind === 'answer' ? this.help.faq(item.faqId) ?? null : null,
      options: item.kind === 'did-you-mean' ? item.faqIds.map(id => this.help.faq(id)).filter((f): f is HelpFaq => !!f) : []
    }))
  );

  /** Where focus was before the panel opened, so closing can put it back. */
  private returnFocus: HTMLElement | null = null;

  constructor() {
    effect(() => {
      if (this.visible()) {
        untracked(() => {
          if (!this.returnFocus) this.returnFocus = document.activeElement as HTMLElement | null;
        });
      } else if (!this.panel.open() && this.returnFocus) {
        // Opened from the profile menu or drawer, the item that had focus is gone by now (the menu
        // closed), so fall back to the header's Help button.
        const saved = this.returnFocus;
        this.returnFocus = null;
        queueMicrotask(() => {
          const target = saved.isConnected ? saved : document.querySelector<HTMLElement>('button[aria-label="Help"][aria-expanded]');
          target?.focus?.();
        });
      }
    });

    // Focus the question box when the panel opens, and bring the newest question into view — scrolled
    // to the question rather than the bottom, so a long answer reads from its start.
    afterRenderEffect(() => {
      // Length, not the thread itself: a thumbs up on an older answer changes the thread but
      // mustn't scroll the panel away from it.
      const length = this.threadLength();
      if (!this.visible()) return;
      const body = this.body()?.nativeElement;
      if (length === 0) {
        this.input()?.nativeElement.focus();
        return;
      }
      const users = body?.querySelectorAll<HTMLElement>('[data-help-user]');
      const last = users?.[users.length - 1];
      if (body && last) body.scrollTop = Math.max(0, last.offsetTop - 16);
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.panel.spotlight() !== null) this.panel.endSpotlight();
    else if (this.panel.open()) this.panel.close();
  }

  onQuestion(event: Event): void {
    this.question.set((event.target as HTMLInputElement).value);
  }

  submit(event: Event): void {
    event.preventDefault();
    const q = this.question();
    if (!q.trim()) return;
    this.panel.ask(q);
    this.question.set('');
  }

  ask(faqId: string): void {
    this.panel.askFaq(faqId);
  }

  browseAll(): void {
    void this.router.navigateByUrl('/help');
    if (!this.panel.desktop()) this.panel.close();
  }

  retryLoad(): void {
    void this.help.load();
  }
}
