import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from '@shared/components/header/header.component';
import { ToastContainerComponent } from '@shared/components/toast-container/toast-container.component';
import { WhatsNewDialogComponent } from '@features/whats-new/components/whats-new-dialog/whats-new-dialog.component';
import { IdleTimeoutService } from '@core/services/idle-timeout.service';
import { DataPreloadService } from '@core/services/data-preload.service';
import { UserPreferencesService } from '@core/services/user-preferences.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { WhatsNewService } from '@core/services/whats-new.service';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { filter } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, ToastContainerComponent, WhatsNewDialogComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {
  readonly isAuthenticated = signal(false);

  /** Public: the template reads unseenReleases() straight off it. */
  readonly whatsNew = inject(WhatsNewService);
  readonly showWhatsNew = signal(false);

  private readonly msalService = inject(MsalService);
  private readonly broadcastService = inject(MsalBroadcastService);
  private readonly destroyRef = inject(DestroyRef);

  private whatsNewRequested = false;

  constructor() {
    // Check if already authenticated (e.g. returning from redirect or existing session)
    this.isAuthenticated.set(this.msalService.instance.getAllAccounts().length > 0);
    this.loadWhatsNewOnce();

    // Listen for MSAL interactions to complete, then re-check auth state
    this.broadcastService.inProgress$
      .pipe(
        filter(status => status === InteractionStatus.None),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.isAuthenticated.set(this.msalService.instance.getAllAccounts().length > 0);
        this.loadWhatsNewOnce();
      });

    inject(IdleTimeoutService).start();
    inject(DataPreloadService);
    inject(UserPreferencesService);
    inject(UsageTrackingService); // initializes router listener for screen tracking
  }

  /** Records the release as seen. Reached from the X, the backdrop, Escape, and "Got it". */
  onWhatsNewClose(): void {
    this.whatsNew.markCurrentAsSeen();
    this.showWhatsNew.set(false);
  }

  /**
   * Fetches the release notes once there is a signed-in account — the endpoint is authenticated,
   * so calling earlier just 401s.
   *
   * Called imperatively rather than from an effect(): load() writes the signals hasUnseen() reads,
   * which in an effect would loop. Failures are swallowed; release notes must never be the reason
   * the app fails to start.
   */
  private loadWhatsNewOnce(): void {
    if (this.whatsNewRequested || !this.isAuthenticated()) return;
    this.whatsNewRequested = true;

    this.whatsNew
      .load()
      .then(() => {
        if (this.whatsNew.hasUnseen()) this.showWhatsNew.set(true);
      })
      .catch(() => {
        // Nothing to announce if we could not read the notes.
      });
  }
}
