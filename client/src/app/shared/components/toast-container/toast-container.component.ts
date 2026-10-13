import { Component, inject } from '@angular/core';
import { ToastService, Toast } from '@core/services/toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  template: `
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
      @for (toast of toastService.toasts(); track toast.id) {
        <div
          class="px-4 py-3 rounded-lg shadow-lg flex items-start gap-3 animate-slide-in"
          [class]="getToastClasses(toast.type)"
        >
          <svg class="flex-shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            @switch (toast.type) {
              @case ('success') {
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <path d="m9 11 3 3L22 4"/>
              }
              @case ('error') {
                <circle cx="12" cy="12" r="10"/>
                <path d="m15 9-6 6"/>
                <path d="m9 9 6 6"/>
              }
              @case ('warning') {
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>
                <path d="M12 9v4"/>
                <path d="M12 17h.01"/>
              }
              @default {
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 16v-4"/>
                <path d="M12 8h.01"/>
              }
            }
          </svg>
          <span class="flex-1 text-sm leading-snug">{{ toast.message }}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            (click)="toastService.dismiss(toast.id)"
            class="flex-shrink-0 p-0.5 hover:opacity-70 transition-opacity"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18"/>
              <path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    .animate-slide-in {
      animation: slideIn 0.3s ease-out;
    }
  `]
})
export class ToastContainerComponent {
  toastService = inject(ToastService);

  getToastClasses(type: Toast['type']): string {
    const baseClasses = 'text-white';
    switch (type) {
      case 'success':
        return `${baseClasses} bg-scoular-green-accessible`;
      case 'error':
        return `${baseClasses} bg-scoular-red-accessible`;
      case 'warning':
        return `${baseClasses} bg-amber-500`;
      case 'info':
      default:
        return `${baseClasses} bg-scoular-blue`;
    }
  }
}
