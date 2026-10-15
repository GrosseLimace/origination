// Angular core
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

// Angular router
import { NavigationEnd, Router } from '@angular/router';

// RxJS
import { filter, map } from 'rxjs';

// Models
import { HelpAction } from '@models';

// Project services
import { AppStateService } from './app-state.service';
import { HelpPanelStateService } from './help-panel-state.service';
import { HelpService } from './help.service';
import { ToastService } from './toast.service';
import { UsageTrackingService } from './usage-tracking.service';
import { UserTradeUnitsService } from './user-trade-units.service';

// Shared utils
import { matchHelpQuestion } from '@shared/utils/help-match';

/** One entry in the panel's conversation. */
export type HelpThreadItem =
  | { kind: 'user'; text: string }
  | { kind: 'answer'; faqId: string; feedback: 'up' | 'down' | null }
  | { kind: 'did-you-mean'; faqIds: string[] }
  | { kind: 'no-match' }
  | { kind: 'troubleshooter'; tree: string }
  | { kind: 'escalation' };

/**
 * Where each spotlight anchor lives, for when the user asks to be shown a control that isn't on the
 * current screen. Anchors not listed here are only spotlighted where they already are.
 */
const ANCHOR_HOME: Record<string, string> = {
  'trade-unit-selector': '/',
  'query-library': '/build-list',
  'set-season-targets': '/dashboard',
  'producer-search': '/'
};

/**
 * State and behaviour of the Help panel: whether it's open, the conversation in it, the spotlight,
 * and what each answer's buttons do. Root-scoped so the conversation survives navigation — the panel
 * stays open while "Take me there" moves the page underneath it.
 */
@Injectable({ providedIn: 'root' })
export class HelpPanelService {
  private readonly router = inject(Router);
  private readonly help = inject(HelpService);
  private readonly appState = inject(AppStateService);
  private readonly userTradeUnits = inject(UserTradeUnitsService);
  private readonly usageTracking = inject(UsageTrackingService);
  private readonly toasts = inject(ToastService);

  // Open / spotlight / desktop live in the dependency-free HelpPanelStateService so the shell, header
  // and Calculators button can read them without this service's dependencies. This is the only writer.
  private readonly layout = inject(HelpPanelStateService);
  private readonly _open = this.layout.open;
  private readonly _spotlight = this.layout.spotlight;
  private readonly _desktop = this.layout.desktop;
  private readonly _thread = signal<HelpThreadItem[]>([]);
  private readonly _lastError = signal<{ message: string; at: Date } | null>(null);

  readonly open = this._open.asReadonly();
  readonly thread = this._thread.asReadonly();
  /** The data-help-anchor currently being shown, or null. */
  readonly spotlight = this._spotlight.asReadonly();
  /** The most recent error toast, for the support details. */
  readonly lastError = this._lastError.asReadonly();

  /** The panel is laid out beside the page (desktop) and the page should make room for it. */
  readonly pushesPage = this.layout.pushesPage;

  /** True at desktop widths, where the panel sits beside the page instead of covering it. */
  readonly desktop = this._desktop.asReadonly();

  /** Current route without query or fragment: "/", "/build-list", … */
  readonly route = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(e => routePath(e.urlAfterRedirects))
    ),
    { initialValue: routePath(this.router.url) }
  );

  constructor() {
    // Remember the latest error toast. Toasts disappear after a few seconds, but "what was the last
    // error?" is exactly what support asks first.
    // Keyed on the toast id, so other toasts coming and going don't reset the time. The message
    // is trimmed at "Http failure" — Angular's HTTP error text carries the request URL and query,
    // which can hold a searched name, and this ends up in a support ticket.
    let lastErrorId: string | null = null;
    effect(() => {
      const latest = [...this.toasts.toasts()].reverse().find(t => t.type === 'error');
      if (!latest || latest.id === lastErrorId) return;
      lastErrorId = latest.id;
      const message = latest.message.split(/Http failure/i)[0].trim() || 'Request failed';
      untracked(() => this._lastError.set({ message, at: new Date() }));
    });
  }

  toggle(source: string): void {
    if (this._open()) this.close();
    else this.openPanel(source);
  }

  openPanel(source: string): void {
    this._spotlight.set(null);
    if (!this._open()) this.usageTracking.trackHelpOpened(source);
    this._open.set(true);
    void this.help.load();
  }

  close(): void {
    this._open.set(false);
    this._spotlight.set(null);
  }

  /** Clears the conversation, back to the greeting and suggestions. */
  reset(): void {
    this._thread.set([]);
  }

  /** Answers a typed question: an answer, "did you mean", or the no-match fallback. */
  ask(question: string): void {
    const text = question.trim();
    if (!text) return;

    const match = matchHelpQuestion(text, this.help.faqs(), this.route());
    const user: HelpThreadItem = { kind: 'user', text };
    switch (match.kind) {
      case 'answer':
        this.usageTracking.trackHelpAnswer(match.id);
        this.push(user, { kind: 'answer', faqId: match.id, feedback: null });
        break;
      case 'did-you-mean':
        this.push(user, { kind: 'did-you-mean', faqIds: match.ids });
        break;
      case 'no-match':
        this.usageTracking.trackHelpNoMatch(text);
        this.push(user, { kind: 'no-match' });
        break;
    }
  }

  /** Shows a specific question's answer, as if the user had asked it (chips, related, did-you-mean). */
  askFaq(faqId: string): void {
    const faq = this.help.faq(faqId);
    if (!faq) return;
    this.usageTracking.trackHelpAnswer(faqId);
    this.push({ kind: 'user', text: faq.chip ?? faq.question }, { kind: 'answer', faqId, feedback: null });
  }

  /** Opens the panel on a question, from outside the panel (the Help page's "Ask in the Help panel"). */
  openOn(question: string, source: string): void {
    this.openPanel(source);
    void this.help.load().then(() => this.ask(question));
  }

  startTroubleshooter(tree: string): void {
    this.push({ kind: 'troubleshooter', tree });
  }

  escalate(): void {
    this.push({ kind: 'escalation' });
  }

  /** Thumbs up/down on the answer at `index` in the thread. */
  setFeedback(index: number, helpful: boolean): void {
    const item = this._thread()[index];
    if (item?.kind !== 'answer' || item.feedback !== null) return;
    this.usageTracking.trackHelpFeedback(item.faqId, helpful);
    this._thread.update(thread => thread.map((t, i) => (i === index ? { ...item, feedback: helpful ? 'up' : 'down' } : t)));
  }

  /** Runs an answer's button. See HelpAction for the kinds. */
  run(action: HelpAction): void {
    switch (action.kind) {
      case 'route':
        if (action.target) this.navigate(action.target);
        break;
      case 'spotlight':
        if (action.target) this.showOnScreen(action.target);
        break;
      case 'tup':
        this.userTradeUnits.openPreferences();
        break;
      case 'producer-tab':
        this.openProducerTab(action.target ?? 'contracts');
        break;
      case 'help':
        this.navigate('/help');
        break;
    }
  }

  /** Outlines the control carrying data-help-anchor="anchor", going to its screen first if needed. */
  showOnScreen(anchor: string): void {
    const onScreen = document.querySelector(`[data-help-anchor="${CSS.escape(anchor)}"]`) !== null;
    const home = ANCHOR_HOME[anchor];
    if (!onScreen && home && home !== this.route()) void this.router.navigateByUrl(home);
    this._spotlight.set(anchor);
  }

  endSpotlight(): void {
    this._spotlight.set(null);
  }

  /** On a phone the panel covers the page, so moving the page underneath means closing it. */
  private navigate(url: string): void {
    void this.router.navigateByUrl(url);
    if (!this.isDesktop()) this.close();
  }

  /** Opens a tab on the producer being viewed; without one, just the Producers page. */
  private openProducerTab(tab: string): void {
    const customer = this.appState.selectedCustomer();
    if (customer) {
      void this.router.navigate(['/'], { queryParams: { customerId: customer.id, tab } });
      if (!this.isDesktop()) this.close();
    } else {
      this.navigate('/');
    }
  }

  private push(...items: HelpThreadItem[]): void {
    this._spotlight.set(null);
    this._thread.update(thread => [...thread, ...items]);
  }

  private isDesktop(): boolean {
    return this._desktop();
  }
}

function routePath(url: string): string {
  const path = url.split(/[?#]/)[0];
  return path === '' ? '/' : path;
}
