// Angular core
import { ChangeDetectionStrategy, Component, DestroyRef, Injector, afterNextRender, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

// Angular router
import { ActivatedRoute } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';

// Models
import { HelpAction, HelpFaq } from '@models';

// Core services
import { HelpPanelService } from '@core/services/help-panel.service';
import { HelpService } from '@core/services/help.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';

// Shared
import { HelpIconComponent } from '@shared/components/help-icon/help-icon.component';
import { filterHelpFaqs } from '@shared/utils/help-match';
import { splitHelpText } from '@shared/utils/help-text';
import { revealAfterRender } from '@shared/utils/help-reveal';

/**
 * The full Help page (/help): every question, browsable by category or searchable, with deep links
 * to a single question (/help#faq-id) to share with a colleague. Reached from the panel's "Browse all
 * help topics" and its book icon.
 */
@Component({
  selector: 'app-help',
  standalone: true,
  imports: [HelpIconComponent, NgTemplateOutlet],
  templateUrl: './help.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HelpComponent {
  readonly help = inject(HelpService);
  private readonly panel = inject(HelpPanelService);
  private readonly route = inject(ActivatedRoute);
  private readonly usageTracking = inject(UsageTrackingService);
  private readonly injector = inject(Injector);

  readonly query = signal('');
  readonly category = signal<string | null>(null);
  /** The expanded question, or null. */
  readonly openId = signal<string | null>(null);

  readonly searching = computed(() => this.query().trim().length > 0);

  readonly tiles = computed(() => this.help.content()?.categories ?? []);

  /** Browsing: every category (or the chosen one) with its questions. */
  readonly sections = computed(() =>
    this.tiles()
      .filter(c => this.category() === null || c.id === this.category())
      .map(c => ({ ...c, faqs: c.faqIds.map(id => this.help.faq(id)).filter((f): f is HelpFaq => !!f) }))
  );

  /** Searching: matching questions, each once, labelled with its first category. */
  readonly results = computed(() => {
    if (!this.searching()) return [];
    const categoryOf = new Map<string, string>();
    for (const c of this.tiles()) for (const id of c.faqIds) if (!categoryOf.has(id)) categoryOf.set(id, c.name);
    return filterHelpFaqs(this.query(), this.help.faqs()).map(faq => ({ faq, category: categoryOf.get(faq.id) ?? '' }));
  });

  constructor() {
    this.usageTracking.trackHelpOpened('page');
    void this.help.load();

    // /help#faq-id opens that question once the content is in, and scrolls to it.
    this.route.fragment.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(fragment => {
      if (!fragment) return;
      void this.help.load().then(() => {
        if (!this.help.faq(fragment)) return;
        this.query.set('');
        this.category.set(null);
        this.openId.set(fragment);
        this.usageTracking.trackHelpAnswer(fragment);
        afterNextRender(() => document.getElementById('help-q-' + fragment)?.scrollIntoView({ block: 'start' }), { injector: this.injector });
      });
    });
  }

  onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.openId.set(null);
  }

  clearQuery(): void {
    this.query.set('');
  }

  /** Choosing a tile filters the list below the tiles, so bring that list up to where the user is looking. */
  toggleCategory(id: string): void {
    const choosing = this.category() !== id;
    this.category.set(choosing ? id : null);
    this.openId.set(null);
    if (choosing) revealAfterRender(this.injector, () => document.getElementById('help-cat-' + id), 'start');
  }

  /** Opening a question scrolls just enough to show its whole answer. */
  toggle(faqId: string): void {
    const opening = this.openId() !== faqId;
    this.openId.set(opening ? faqId : null);
    if (opening) {
      this.usageTracking.trackHelpAnswer(faqId);
      revealAfterRender(this.injector, () => document.getElementById('help-q-' + faqId));
    }
  }

  run(action: HelpAction): void {
    this.panel.run(action);
  }

  askInPanel(): void {
    this.panel.openOn(this.query(), 'page');
  }

  text(value: string) {
    return splitHelpText(value);
  }
}
