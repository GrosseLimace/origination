import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { ProducerInsightsPanels } from './producer-insights-panels.state';

/**
 * The Producer Insights button in the profile header, which opens and closes the Producer Insights panels under it.
 * They close again when the profile goes. Its element takes no space, so the button sits in the header's row.
 */
@Component({
  selector: 'app-producer-insights-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  templateUrl: './producer-insights-toggle.component.html',
})
export class ProducerInsightsToggleComponent {
  readonly panels = inject(ProducerInsightsPanels);

  constructor() {
    // The panels belonged to the profile before they were Producers'; they still close when it goes.
    inject(DestroyRef).onDestroy(() => this.panels.open.set(false));
  }
}
