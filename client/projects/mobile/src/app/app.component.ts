import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

import { MobileAuthPort } from './core/auth/auth.port';
import { NoticeService } from './core/errors/notice.service';
import { ConnectivityService } from './core/offline/connectivity.service';
import { SyncQueueService } from './core/offline/sync-queue.service';
import { SessionStore } from './core/state/session.store';
import { ThemeMode, ThemeService } from './core/theme/theme.service';
import { environment } from '../environments/environment';

@Component({
  selector: 'mob-root',
  imports: [RouterOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-full flex flex-col" [style.padding-top]="'var(--mob-safe-top)'">
      <!-- Same look as the desktop Workbench's own phone-width header (shared/components/header): white bar,
           Scoular lockup, environment pill, green avatar. Like the desktop, the product name shows only from
           sm up — beside the logo, never under it — because a phone-width bar has no room for it. -->
      <header class="sticky top-0 z-40 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700" [style.height]="'var(--mob-header-h)'">
        <div class="h-full px-4 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 min-w-0">
            <a routerLink="/" class="flex items-center shrink-0" aria-label="Origination Workbench home">
              <img src="assets/images/scoular-logo-light.webp" alt="Scoular" class="h-8 shrink-0 hidden dark:block">
              <img src="assets/images/scoular-logo-dark.webp" alt="Scoular" class="h-8 shrink-0 dark:hidden">
            </a>
            <span class="hidden sm:block h-6 w-px bg-gray-300 dark:bg-gray-600 shrink-0" aria-hidden="true"></span>
            <p class="hidden sm:block text-sm font-medium text-gray-500 dark:text-white leading-normal truncate">Origination Workbench</p>
            @if (envName) {
              <span class="shrink-0 px-2 py-0.5 text-xs font-bold rounded-full leading-none whitespace-nowrap"
                    [class]="envName === 'Dev' || envName === 'Local' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'">
                {{ envName }}
              </span>
            }
          </div>
          <div class="flex items-center gap-2 text-xs shrink-0">
            @if (!online()) {
              <span class="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-1 font-semibold" role="status">Offline</span>
            }
            @if (pending() > 0) {
              <span class="rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 px-2 py-1" role="status" [attr.aria-label]="pending() + ' changes waiting to sync'">{{ pending() }} to sync</span>
            }
            @if (auth.isSignedIn()) {
              <button type="button"
                      class="flex items-center justify-center w-10 h-10 rounded-full bg-scoular-green-accessible hover:bg-scoular-green focus:outline-none focus:ring-2 focus:ring-scoular-green focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-colors"
                      (click)="menuOpen.set(!menuOpen())" [attr.aria-expanded]="menuOpen()" aria-haspopup="menu" aria-label="Account menu">
                <span class="text-sm font-semibold text-white select-none">{{ initials() }}</span>
              </button>
            }
          </div>
        </div>
      </header>

      @if (menuOpen()) {
        <!-- Backdrop closes the menu; the sheet itself holds the actions. -->
        <button type="button" class="fixed inset-0 z-40 bg-black/30" (click)="menuOpen.set(false)" aria-label="Close menu"></button>
        <div class="fixed right-3 z-50 w-72 rounded-2xl bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 p-3 space-y-3"
             [style.top]="'calc(var(--mob-header-h) + var(--mob-safe-top) + 0.5rem)'" role="menu">
          <div class="px-1">
            <div class="font-semibold text-gray-900 dark:text-gray-100">{{ auth.account()?.name || auth.account()?.username }}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ auth.account()?.username }}</div>
          </div>

          <div>
            <div class="mob-label px-1 mb-1">Appearance</div>
            <div class="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 dark:bg-gray-900 p-1" role="radiogroup" aria-label="Appearance">
              @for (m of modes; track m.id) {
                <button type="button" role="radio" [attr.aria-checked]="theme.mode() === m.id"
                        class="h-10 rounded-md text-sm"
                        [class]="theme.mode() === m.id ? 'bg-white dark:bg-gray-700 shadow font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'"
                        (click)="theme.setMode(m.id)">{{ m.label }}</button>
              }
            </div>
          </div>

          <a routerLink="/" (click)="menuOpen.set(false)" role="menuitem"
             class="mob-tap w-full justify-start px-3 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700">
            Change trade units
            @if (session.hasSelection()) { <span class="ml-auto text-xs text-gray-500 dark:text-gray-400">{{ session.selectedTradeUnits().length }} selected</span> }
          </a>

          <button type="button" role="menuitem" class="mob-tap w-full justify-start px-3 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30" (click)="signOut()">
            Sign out
          </button>
        </div>
      }

      @for (notice of notices.items(); track notice.id) {
        <div class="mx-4 mt-3 rounded-lg px-3 py-2 text-sm flex items-start justify-between gap-3"
             [class]="notice.kind === 'error' ? 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800' : 'bg-blue-50 text-blue-900 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-100 dark:border-blue-800'"
             role="alert">
          <span>{{ notice.message }}</span>
          <button type="button" class="mob-tap -my-1 px-2" (click)="notices.dismiss(notice.id)" aria-label="Dismiss">×</button>
        </div>
      }

      <main class="flex-1 px-4 py-3" [style.padding-bottom]="'calc(1rem + var(--mob-safe-bottom))'">
        <router-outlet />
      </main>
    </div>
  `,
})
export class AppComponent {
  /** Same pill as the desktop header: amber for Dev/Local, blue otherwise. */
  protected readonly envName = environment.envName;
  protected readonly auth = inject(MobileAuthPort);
  protected readonly notices = inject(NoticeService);
  protected readonly theme = inject(ThemeService);
  protected readonly session = inject(SessionStore);
  private readonly connectivity = inject(ConnectivityService);
  private readonly queue = inject(SyncQueueService);

  protected readonly menuOpen = signal(false);
  protected readonly modes: { id: ThemeMode; label: string }[] = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];

  protected readonly online = this.connectivity.online;
  protected readonly pending = this.queue.pendingCount;
  protected readonly initials = computed(() => {
    const name = this.auth.account()?.name ?? this.auth.account()?.username ?? '';
    return name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '•';
  });

  protected signOut(): void {
    this.menuOpen.set(false);
    void this.auth.signOut();
  }
}
