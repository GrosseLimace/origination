import { ChangeDetectionStrategy, Component, Injector, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import { HelpFaq } from '@models';
import { HelpPanelService } from '@core/services/help-panel.service';
import { HelpService } from '@core/services/help.service';
import { splitHelpText } from '@shared/utils/help-text';
import { revealAfterRender } from '@shared/utils/help-reveal';
import { HelpIconComponent } from '@shared/components/help-icon/help-icon.component';

/**
 * One answer in the Help panel: the layered card from the approved design. Title and quick answer
 * always; then, only when the question has them, the action buttons, "Show steps", the in-app link,
 * "Try an example", "Troubleshoot this" and "Still need help?"; then the feedback row and related
 * questions.
 */
@Component({
  selector: 'app-help-answer-card',
  standalone: true,
  imports: [HelpIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './help-answer-card.component.html'
})
export class HelpAnswerCardComponent {
  private readonly panel = inject(HelpPanelService);
  private readonly help = inject(HelpService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  readonly faq = input.required<HelpFaq>();
  /** Position in the panel thread, so feedback lands on the right answer. */
  readonly index = input.required<number>();
  readonly feedback = input<'up' | 'down' | null>(null);

  private readonly stepsToggled = signal<boolean | null>(null);
  readonly stepsOpen = computed(() => this.stepsToggled() ?? !!this.faq().stepsOpen);
  readonly examplesOpen = signal(false);
  readonly troubleOpen = signal(false);

  readonly answer = computed(() => splitHelpText(this.faq().answer));
  readonly steps = computed(() => (this.faq().steps ?? []).map(splitHelpText));
  readonly related = computed(() =>
    this.faq().related.map(id => this.help.faq(id)).filter((f): f is HelpFaq => f !== undefined)
  );

  readonly headingId = computed(() => `help-answer-${this.index()}`);

  toggleSteps(): void {
    this.stepsToggled.set(!this.stepsOpen());
    if (this.stepsOpen()) this.reveal('steps');
  }

  toggleExamples(): void {
    this.examplesOpen.set(!this.examplesOpen());
    if (this.examplesOpen()) this.reveal('examples');
  }

  toggleTrouble(): void {
    this.troubleOpen.set(!this.troubleOpen());
    if (this.troubleOpen()) this.reveal('trouble');
  }

  /** Whatever just expanded is often below the fold of the panel, so scroll it into view. */
  private reveal(part: string): void {
    revealAfterRender(this.injector, () => document.getElementById(`${this.headingId()}-${part}`));
  }

  run(index: number): void {
    const action = this.faq().actions?.[index];
    if (action) this.panel.run(action);
  }

  runLink(): void {
    const link = this.faq().link;
    if (link) this.panel.run(link);
  }

  /** Opens Build a List on the named Query Library entry. */
  tryExample(name: string): void {
    void this.router.navigate(['/build-list'], { queryParams: { query: name } });
  }

  troubleshoot(entryIndex: number): void {
    const entry = this.faq().troubleshoot?.[entryIndex];
    if (!entry) return;
    if (entry.tree) this.panel.startTroubleshooter(entry.tree);
    else if (entry.faqId) this.panel.askFaq(entry.faqId);
  }

  escalate(): void {
    this.panel.escalate();
  }

  rate(helpful: boolean): void {
    this.panel.setFeedback(this.index(), helpful);
  }

  ask(faqId: string): void {
    this.panel.askFaq(faqId);
  }
}
