import { ChangeDetectionStrategy, Component, computed, effect, inject, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { CustomerSummary, MobileApiService } from '../../core/api/mobile-api.service';
import { SessionStore } from '../../core/state/session.store';
import { SpinnerComponent } from '../../core/ui/spinner.component';

/**
 * Card #641 — producers for the selected trade units: browse them, or search to narrow.
 * Saved lists are not on the phone (decided 2026-10-14); originators search instead.
 */
@Component({
  selector: 'mob-producers-page',
  imports: [SpinnerComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-2 text-sm">
        <a routerLink="/" class="mob-tap shrink-0 -ml-2 px-2 text-scoular-green-accessible dark:text-scoular-green" aria-label="Back to trade units">
          <span aria-hidden="true" class="text-xl leading-none">‹</span><span class="ml-1">Back</span>
        </a>
        <span class="font-semibold text-gray-900 dark:text-gray-100 truncate text-right" [title]="selectionLabel()">{{ selectionLabel() }}</span>
      </div>

      <label class="block">
        <span class="sr-only">Search producers by name</span>
        <input type="search" inputmode="search" autocomplete="off" enterkeyhint="search"
               class="w-full h-12 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-scoular-green"
               placeholder="Search producers…" [value]="term()" (input)="onInput($any($event.target).value)" aria-label="Search producers by name" />
      </label>

      @if (query().length === 1) {
        <p class="text-sm text-gray-500 dark:text-gray-400">Type at least two characters.</p>
      } @else if (producers.isLoading()) {
        <mob-spinner [label]="query().length ? 'Searching…' : 'Loading producers…'" />
      } @else if (producers.error()) {
        <p class="text-sm text-red-700 dark:text-red-400" role="alert">Couldn't load producers right now. Check your connection and try again.</p>
      } @else if (producers.hasValue()) {
        @if (producers.value().length === 0) {
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ query().length >= 2 ? 'No producers match “' + query() + '”.' : 'No producers here yet.' }}</p>
        } @else {
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ producers.value().length }} producer{{ producers.value().length === 1 ? '' : 's' }}@if (producers.value().length >= 50) { (first 50 — search to narrow) }
          </p>
        }
        <ul class="divide-y divide-gray-200 dark:divide-gray-700 rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700" role="list">
          @for (c of producers.value(); track c.id) {
            <li>
              <a [routerLink]="['/customers', c.id]" class="flex items-center justify-between gap-3 px-4 min-h-14 py-2 active:bg-gray-50 dark:active:bg-gray-700">
                <div class="min-w-0">
                  <div class="font-semibold text-gray-900 dark:text-gray-100 truncate">{{ c.name }}</div>
                  <div class="text-sm text-gray-500 dark:text-gray-400 truncate">{{ c.location || '—' }}@if (c.scoularId) { · {{ c.scoularId }} }</div>
                </div>
                <span class="text-gray-400" aria-hidden="true">›</span>
              </a>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class ProducersPage {
  private readonly api = inject(MobileApiService);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);

  protected readonly term = signal('');
  protected readonly query = signal('');
  private debounce: ReturnType<typeof setTimeout> | null = null;

  /** "2190 - Pratt, KS"; several become "2190 - Pratt, KS, 2291 - Salina, KS". */
  protected readonly selectionLabel = computed(() => {
    const codes = this.session.selectedTradeUnits();
    if (codes.length === 0) return 'No trade unit selected';
    return codes.map((c) => `${c} - ${this.session.tradeUnitName(c)}`).join(', ');
  });

  protected readonly producers = resource<CustomerSummary[], { q: string; tus: string[] }>({
    params: () => ({ q: this.query().trim(), tus: this.session.selectedTradeUnits() }),
    loader: async ({ params }) => {
      if (params.tus.length === 0) return [];
      if (params.q.length === 1) return [];
      return this.api.searchCustomers(params.q || undefined, params.tus, 50);
    },
  });

  constructor() {
    void this.session.ensureLoaded();
    // No selection (fresh session, or entitlement changed) → back to the trade-unit step.
    effect(() => {
      if (!this.session.loading() && this.session.tradeUnits().length > 0 && !this.session.hasSelection()) {
        void this.router.navigateByUrl('/');
      }
    });
  }

  protected onInput(value: string): void {
    this.term.set(value);
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.query.set(value), 300);
  }
}
