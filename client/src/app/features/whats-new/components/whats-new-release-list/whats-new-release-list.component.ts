// Angular core
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

// Models
import type { WhatsNewRelease } from '@models';

// Feature helpers
import { groupReleases } from '../../whats-new-groups';
import { WHATS_NEW_KIND_LABELS, WHATS_NEW_KIND_PILL_CLASSES } from '../../whats-new-kind';

/**
 * Renders a run of releases with their items grouped under headings. Presentational only, and
 * shared by the dialog and the What's New page so the markup exists in one place — the dialog
 * shows the unseen releases, the page shows all of them.
 */
@Component({
  selector: 'app-whats-new-release-list',
  standalone: true,
  templateUrl: './whats-new-release-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WhatsNewReleaseListComponent {
  readonly releases = input.required<WhatsNewRelease[]>();

  /** Grouped once per input change rather than on every render pass. */
  readonly groupedReleases = computed(() => groupReleases(this.releases()));

  readonly kindLabels = WHATS_NEW_KIND_LABELS;
  readonly kindClasses = WHATS_NEW_KIND_PILL_CLASSES;
}
