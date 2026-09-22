// Angular core
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';

// Shared components
import { CardComponent } from '@shared/components/card/card.component';

// Core services
import { WhatsNewService } from '@core/services/whats-new.service';

// Feature components
import { WhatsNewReleaseListComponent } from '../../components/whats-new-release-list/whats-new-release-list.component';

/**
 * The permanent home for release notes, reached from the What's New row in the profile menu.
 * Visiting counts as acknowledging the current release, so the unread dot clears here as well as
 * from the dialog.
 */
@Component({
  selector: 'app-whats-new',
  standalone: true,
  imports: [CardComponent, WhatsNewReleaseListComponent],
  templateUrl: './whats-new.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WhatsNewComponent implements OnInit {
  private readonly whatsNew = inject(WhatsNewService);

  readonly releases = this.whatsNew.releases;
  readonly version = this.whatsNew.version;
  readonly loading = signal(false);
  readonly loadFailed = signal(false);

  /** The build line shown at the foot of the page, or null before the version call lands. */
  readonly buildLine = computed(() => {
    const v = this.version();
    if (v === null) return null;

    const release = v.releaseVersion ? `Release ${v.releaseVersion}` : 'Unreleased';
    return `${release} · Build ${v.shortSha} (#${v.buildNumber}) · ${v.environment}`;
  });

  ngOnInit(): void {
    // Called imperatively rather than from an effect(): load() writes the same signals this
    // component reads, which in an effect would loop.
    if (!this.whatsNew.loaded()) {
      this.loading.set(true);
      this.whatsNew
        .load()
        .then(() => this.whatsNew.markCurrentAsSeen())
        .catch(() => this.loadFailed.set(true))
        .finally(() => this.loading.set(false));
      return;
    }

    this.whatsNew.markCurrentAsSeen();
  }
}
