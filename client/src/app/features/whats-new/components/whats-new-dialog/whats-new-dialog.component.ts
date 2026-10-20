// Angular core
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

// Angular router
import { RouterLink } from '@angular/router';

// Models
import type { WhatsNewRelease } from '@models';

// Shared components
import {
  DialogComponent,
  DialogContentComponent,
  DialogDescriptionComponent,
  DialogFooterComponent,
  DialogHeaderComponent,
  DialogTitleComponent
} from '@shared/components/dialog/dialog.component';
import { ButtonComponent } from '@shared/components/button/button.component';

// Feature components
import { WhatsNewReleaseListComponent } from '../whats-new-release-list/whats-new-release-list.component';

/**
 * Announces the releases the user has not acknowledged yet. Shown once after a deploy that
 * carried release notes; the same content stays reachable from the What's New page afterwards.
 *
 * Presentational — it holds no state and injects no service. The app shell owns `isOpen` and
 * records the acknowledgment, so closing by any route goes through one place.
 */
@Component({
  selector: 'app-whats-new-dialog',
  standalone: true,
  imports: [
    RouterLink,
    ButtonComponent,
    DialogComponent,
    DialogHeaderComponent,
    DialogTitleComponent,
    DialogDescriptionComponent,
    DialogContentComponent,
    DialogFooterComponent,
    WhatsNewReleaseListComponent
  ],
  templateUrl: './whats-new-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // No Escape listener of its own: app-dialog handles Escape and routes it through (close), the
  // same as the X and the backdrop. This component used to add one when app-dialog did not, and
  // once app-dialog gained it the two together closed the dialog twice per keypress.
})
export class WhatsNewDialogComponent {
  readonly isOpen = input.required<boolean>();
  readonly releases = input.required<WhatsNewRelease[]>();
  readonly close = output<void>();

  onClose(): void {
    this.close.emit();
  }
}
