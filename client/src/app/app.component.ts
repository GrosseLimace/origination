import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MsalService } from '@azure/msal-angular';
import { HeaderComponent } from '@shared/components/header/header.component';
import { FooterComponent } from '@shared/components/footer/footer.component';
import { ToastContainerComponent } from '@shared/components/toast-container/toast-container.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FooterComponent, ToastContainerComponent],
  templateUrl: './app.component.html'
})
export class AppComponent implements OnInit {
  private readonly msalService = inject(MsalService);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    // Process the redirect response from Azure AD (exchanges auth code for token).
    // Without this, MsalGuard would redirect to login again after each redirect callback.
    this.msalService.handleRedirectObservable()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }
}
