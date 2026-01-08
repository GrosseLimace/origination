import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './components/layout/header/header.component';
import { ToastContainerComponent } from './components/ui/toast-container/toast-container.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, ToastContainerComponent],
  template: `
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
      <app-header />
      <main class="container mx-auto px-4 py-6">
        <router-outlet />
      </main>
      <app-toast-container />
    </div>
  `
})
export class AppComponent {}
