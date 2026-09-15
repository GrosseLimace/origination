// Angular core
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

// Angular common
import { NgTemplateOutlet } from '@angular/common';

// Models
import type { WhatsNewItemKind, WhatsNewRelease } from '@models';

// Feature helpers
import { groupReleases } from '../../whats-new-groups';
import { WHATS_NEW_KIND_LABELS, WHATS_NEW_KIND_PILL_CLASSES } from '../../whats-new-kind';

/**
 * Renders a run of releases with their items grouped under headings. Presentational only, and
 * shared by the dialog and the What's New page so the item markup exists in one place.
 */
@Component({
  selector: 'app-whats-new-release-list',
  standalone: true,
  imports: [NgTemplateOutlet],
  templateUrl: './whats-new-release-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WhatsNewReleaseListComponent {
  readonly releases = input.required<WhatsNewRelease[]>();

  /**
   * How much frame to put around each release.
   *
   * `timeline` is the history page: a dated rail down the side, so a reader can see at a glance
   * how often releases land and which one they are looking at.
   *
   * `compact` is the dialog, which already says what it is in its own header. Repeating a release
   * title and summary there would only push the features further down the panel.
   */
  readonly variant = input<'timeline' | 'compact'>('timeline');

  /** Grouped and date-formatted once per input change rather than on every render pass. */
  readonly groupedReleases = computed(() => groupReleases(this.releases()));

  // Read through methods rather than indexing the records straight from the template: the items
  // arrive through an ng-template context, which Angular types as any, and a Record cannot be
  // indexed with an any key under strict template checking.
  kindLabel(kind: WhatsNewItemKind): string {
    return WHATS_NEW_KIND_LABELS[kind];
  }

  kindClass(kind: WhatsNewItemKind): string {
    return WHATS_NEW_KIND_PILL_CLASSES[kind];
  }
}
