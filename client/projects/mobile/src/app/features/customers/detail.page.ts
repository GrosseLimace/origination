import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CustomerDetail, MobileApiService } from '../../core/api/mobile-api.service';
import { SyncIssuesComponent } from '../../core/offline/sync-issues.component';
import { SessionStore } from '../../core/state/session.store';
import { ContractsTab } from './tabs/contracts.tab';
import { NotesTab } from './tabs/notes.tab';
import { OverviewTab } from './tabs/overview.tab';
import { PlantingTab } from './tabs/planting.tab';
import { StorageTab } from './tabs/storage.tab';
import { TicketsTab } from './tabs/tickets.tab';
import { SpinnerComponent } from '../../core/ui/spinner.component';

export type DetailTab = 'overview' | 'notes' | 'contracts' | 'tickets' | 'planting' | 'storage';

/** One producer, everything the cards ask for, one tab at a time so each tab loads only what it shows. */
@Component({
  selector: 'mob-detail-page',
  imports: [SpinnerComponent, SyncIssuesComponent, RouterLink, OverviewTab, NotesTab, ContractsTab, TicketsTab, PlantingTab, StorageTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Just "‹ Back", pulled up under the app header to save space (user 2026-10-14). -->
    <a routerLink="/producers" class="-mt-2 -ml-2 inline-flex items-center gap-1 min-h-10 px-2 text-sm text-scoular-green-accessible dark:text-scoular-green" aria-label="Back to producers">
      <span aria-hidden="true" class="text-xl leading-none">‹</span><span>Back</span>
    </a>

    @if (customer.isLoading() && !customer.hasValue()) {
      <mob-spinner label="Loading producer…" />
    } @else if (customer.error()) {
      <p class="text-sm text-red-700" role="alert">This producer isn't available. It may be outside your trade units or you may be offline.</p>
    } @else if (customer.hasValue()) {
      <!-- Name, then "City, ST · Scoular ID". Farm and trade unit live in the Overview's Location card. -->
      <header class="mb-3">
        <h1 class="text-2xl font-bold leading-tight text-gray-900 dark:text-gray-100">{{ customer.value().name }}</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          {{ join(', ', customer.value().city, customer.value().stateProvince) || '—' }}@if (customer.value().scoularId) { · {{ customer.value().scoularId }} }
        </p>
      </header>

      <nav class="flex gap-1 overflow-x-auto -mx-4 px-4 border-b border-gray-200 dark:border-gray-700 mb-3" role="tablist" aria-label="Producer sections">
        @for (t of visibleTabs(); track t.id) {
          <button type="button" role="tab" [attr.aria-selected]="tab() === t.id"
                  class="mob-tap shrink-0 px-3 text-sm whitespace-nowrap border-b-2 -mb-px rounded-none"
                  [class]="tab() === t.id ? 'border-scoular-green-accessible text-scoular-green-accessible dark:border-scoular-green dark:text-scoular-green font-semibold' : 'border-transparent text-gray-600 dark:text-white'"
                  (click)="tab.set(t.id)">{{ t.label }}</button>
        }
      </nav>

      <!-- Changes from this phone the server refused (Burdi-style queue); Retry or Discard. -->
      <mob-sync-issues [customerId]="id()" />

      <section role="tabpanel">
        @switch (tab()) {
          @case ('overview')  { <mob-overview-tab [customer]="customer.value()" (contactsChanged)="customer.reload()" /> }
          @case ('notes')     { <mob-notes-tab [customerId]="id()" /> }
          @case ('contracts') { <mob-contracts-tab [customerId]="id()" /> }
          @case ('tickets')   { <mob-tickets-tab [customerId]="id()" /> }
          @case ('planting')  { <mob-planting-tab [customerId]="id()" /> }
          @case ('storage')   { <mob-storage-tab [customerId]="id()" /> }
        }
      </section>
    }
  `,
})
export class DetailPage {
  private readonly api = inject(MobileApiService);
  private readonly session = inject(SessionStore);

  /** Bound from the route by withComponentInputBinding. */
  readonly customerId = input.required<string>();
  protected readonly id = computed(() => Number(this.customerId()));
  protected readonly tab = signal<DetailTab>('overview');

  protected readonly customer = resource<CustomerDetail, number>({
    params: () => this.id(),
    loader: ({ params }) => this.api.getCustomer(params),
  });

  /**
   * Card #648: does this producer's trade unit offer storage? Asked separately so the producer opens
   * without waiting (the first answer per trade unit can take a few seconds; the server then caches it).
   * Idle until the producer has loaded; a producer with no trade unit falls back to the selection.
   */
  protected readonly offersStorage = resource<boolean, string[] | undefined>({
    params: () => {
      if (!this.customer.hasValue()) return undefined;
      const tradeUnit = this.customer.value().tradeUnit;
      const codes = tradeUnit ? [tradeUnit] : this.session.selectedTradeUnits();
      return codes.length ? codes : undefined;
    },
    loader: async ({ params }) => (await this.api.getTradeUnitStorage(params)).some((t) => t.offersStorage),
  });

  /** The Storage tab is hidden entirely (not shown empty) unless the trade unit offers storage. */
  protected readonly visibleTabs = computed<{ id: DetailTab; label: string }[]>(() => {
    const tabs: { id: DetailTab; label: string }[] = [
      { id: 'overview', label: 'Overview' },
      { id: 'notes', label: 'Notes' },
      { id: 'contracts', label: 'Contracts' },
      { id: 'tickets', label: 'Tickets' },
      { id: 'planting', label: 'Planting' },
    ];
    if (this.offersStorage.hasValue() && this.offersStorage.value()) tabs.push({ id: 'storage', label: 'Storage & DP' });
    return tabs;
  });

  constructor() {
    void this.session.ensureLoaded();
  }

  protected join(separator: string, ...parts: (string | null | undefined)[]): string {
    return parts.filter((p) => !!p).join(separator);
  }
}
