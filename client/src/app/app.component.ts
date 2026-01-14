import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './components/layout/header/header.component';
import { FooterComponent } from './components/layout/footer/footer.component';
import { ToastContainerComponent } from './components/ui/toast-container/toast-container.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FooterComponent, ToastContainerComponent],
  template: `
    <div class="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900 transition-colors">
      <app-header />
      <main class="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-grow">
        <router-outlet />
      </main>
      <app-footer />
      <app-toast-container />
    </div>
  `
})
export class AppComponent {}
