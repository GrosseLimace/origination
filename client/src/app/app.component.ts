import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from '@shared/components/header/header.component';
import { ToastContainerComponent } from '@shared/components/toast-container/toast-container.component';
import { IdleTimeoutService } from '@core/services/idle-timeout.service';
import { DataPreloadService } from '@core/services/data-preload.service';
import { UserPreferencesService } from '@core/services/user-preferences.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { filter } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, ToastContainerComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {
  readonly isAuthenticated = signal(false);

  private readonly msalService = inject(MsalService);
  private readonly broadcastService = inject(MsalBroadcastService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Check if already authenticated (e.g. returning from redirect or existing session)
    this.isAuthenticated.set(this.msalService.instance.getAllAccounts().length > 0);

    // Listen for MSAL interactions to complete, then re-check auth state
    this.broadcastService.inProgress$
      .pipe(
        filter(status => status === InteractionStatus.None),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.isAuthenticated.set(this.msalService.instance.getAllAccounts().length > 0);
      });

    inject(IdleTimeoutService).start();
    inject(DataPreloadService);
    inject(UserPreferencesService);
    inject(UsageTrackingService); // initializes router listener for screen tracking
  }
}
