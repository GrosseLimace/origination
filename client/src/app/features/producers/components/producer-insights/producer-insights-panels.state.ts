import { Injectable, signal } from '@angular/core';

/**
 * Whether the Producer Insights panels are open: Producer Insights, the Contract Pacing card and Growth Opportunity.
 * The Producer Insights button and the Harvest Contract Pace box open and close them; the panels show under the
 * profile header, in another slot, so they all share it here. Closed by default, and again when the profile goes.
 */
@Injectable({ providedIn: 'root' })
export class ProducerInsightsPanels {
  readonly open = signal(false);

  toggle(): void {
    this.open.update(open => !open);
  }
}
