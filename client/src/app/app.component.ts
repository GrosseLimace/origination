import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { HeaderComponent } from './components/layout/header/header.component';
import { FooterComponent } from './components/layout/footer/footer.component';
import { ToastContainerComponent } from './components/ui/toast-container/toast-container.component';
import { ConfirmDialogComponent } from './components/ui/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FooterComponent, ToastContainerComponent, ConfirmDialogComponent],
  template: `
    <div class="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900 transition-colors">
      <app-header />
      <main class="max-w-[2000px] w-full mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 2xl:px-12 py-4 lg:py-6 flex-grow">
        <router-outlet />
      </main>
      <app-footer />
      <app-toast-container />
      <app-confirm-dialog />
    </div>
  `
})
export class AppComponent implements OnInit {
  constructor(private msalService: MsalService) {}

  ngOnInit(): void {
    // Process the redirect response and set the active account before inProgress$ settles
    // to None — this ensures MsalGuard sees the account when it checks after interaction.
    this.msalService.handleRedirectObservable().subscribe(result => {
      if (result?.account) {
        this.msalService.instance.setActiveAccount(result.account);
      } else {
        const accounts = this.msalService.instance.getAllAccounts();
        if (accounts.length > 0) {
          this.msalService.instance.setActiveAccount(accounts[0]);
        }
      }
    });
  }
}
