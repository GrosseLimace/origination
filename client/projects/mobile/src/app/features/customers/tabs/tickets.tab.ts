import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, resource } from '@angular/core';

import { MobileApiService, TicketSummary } from '../../../core/api/mobile-api.service';
import { SpinnerComponent } from '../../../core/ui/spinner.component';

/**
 * Card #646 — tickets rolled up to count and bushels per contract, plus unapplied. No line items, no weight.
 * Bushels are converted the desktop's way on the server (net weight ÷ the commodity's lb per bushel); "—" when a
 * commodity has no conversion factor. Dark-mode colours like the rest of the app (user 2026-10-15).
 */
@Component({
  selector: 'mob-tickets-tab',
  imports: [SpinnerComponent, DatePipe, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (summary.isLoading() && !summary.hasValue()) {
      <mob-spinner label="Loading tickets…" />
    } @else if (summary.error()) {
      <p class="text-sm text-red-700 dark:text-red-400" role="alert">Couldn't load tickets right now. Try again in a minute.</p>
    } @else if (summary.hasValue()) {
      @let s = summary.value();
      <div class="mob-card flex justify-between">
        <div>
          <div class="mob-label">Tickets</div>
          <div class="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{{ s.totalTickets | number }}</div>
        </div>
        <div class="text-right">
          <div class="mob-label">Bushels</div>
          <div class="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{{ s.totalBushels != null ? (s.totalBushels | number:'1.0-0') : '—' }}</div>
        </div>
      </div>
      <ul class="mt-3 space-y-2" role="list">
        @for (g of s.groups; track g.key) {
          <li class="mob-card flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="font-semibold text-gray-900 dark:text-white truncate">{{ g.key === 'unapplied' ? 'Unapplied' : g.key }}</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">{{ g.commodityCode || '' }}@if (g.lastTicketDate) { · last {{ g.lastTicketDate | date:'MMM d' }} }</div>
            </div>
            <div class="text-right shrink-0">
              <div class="font-semibold tabular-nums text-gray-900 dark:text-white">{{ g.bushels != null ? (g.bushels | number:'1.0-0') + ' bu' : '—' }}</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">{{ g.ticketCount }} ticket{{ g.ticketCount === 1 ? '' : 's' }}</div>
            </div>
          </li>
        }
      </ul>
      @if (s.groups.length === 0) { <p class="mt-6 text-center text-sm text-gray-400 dark:text-gray-500">No tickets.</p> }
    }
  `,
})
export class TicketsTab {
  private readonly api = inject(MobileApiService);
  readonly customerId = input.required<number>();

  protected readonly summary = resource<TicketSummary, number>({
    params: () => this.customerId(),
    loader: ({ params }) => this.api.getTicketSummary(params),
  });
}
