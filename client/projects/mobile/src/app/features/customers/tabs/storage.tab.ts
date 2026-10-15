import { CurrencyPipe, DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, resource } from '@angular/core';

import { DpContractCard, MobileApiService, StorageCard } from '../../../core/api/mobile-api.service';
import { SpinnerComponent } from '../../../core/ui/spinner.component';

/**
 * Card #648 — DP contract balances and storage receipts, following the tickets tab's pattern: a summary per
 * section (count, bushels, charges owed), then one card per contract that expands for detail. No ticket-level
 * detail (the card says count + bushels is enough).
 *
 * DP: one card per DP contract, rolled up on the server the desktop's way (tickets = distinct deliveries,
 * bushels once per delivery, charges summed across charge rows). Storage: one card per warehouse receipt.
 * The whole tab is hidden for trade units that offer no storage (getTradeUnitStorage), so an empty section
 * here means this producer has none, not that the trade unit has no programme.
 */
@Component({
  selector: 'mob-storage-tab',
  imports: [SpinnerComponent, CurrencyPipe, DatePipe, DecimalPipe, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- ─── Deferred payment ─── -->
    <h2 class="mob-label mb-1">Deferred payment (DP)</h2>
    @if (dp.isLoading() && !dp.hasValue()) {
      <mob-spinner label="Loading DP contracts…" [compact]="true" />
    } @else if (dp.error()) {
      <p class="text-sm text-red-700 dark:text-red-400" role="alert">Couldn't load DP contracts right now. Try again in a minute.</p>
    } @else if (dp.hasValue()) {
      @if (dp.value().length > 0) {
        <ng-container [ngTemplateOutlet]="summary" [ngTemplateOutletContext]="{ countLabel: 'Contracts', count: dp.value().length, bushels: dpBushels(), charges: dpCharges() }" />
      }
      <ul class="mt-2 space-y-2" role="list">
        @for (d of dp.value(); track d.id) {
          <li class="mob-card p-0">
            <details class="group">
              <summary class="flex items-center justify-between gap-3 p-4 cursor-pointer list-none">
                <div class="min-w-0">
                  <div class="font-semibold text-gray-900 dark:text-white truncate">{{ d.contractNumber }}</div>
                  <div class="text-sm text-gray-500 dark:text-gray-400 truncate">{{ d.crop }} · {{ d.ticketCount }} ticket{{ d.ticketCount === 1 ? '' : 's' }}@if (d.since) { · since {{ d.since | date:'MMM d, y' }} }</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <div class="text-right">
                    <div class="font-semibold tabular-nums whitespace-nowrap text-gray-900 dark:text-white">{{ d.bushels != null ? (d.bushels | number:'1.0-0') + ' bu' : '—' }}</div>
                    <div class="text-sm tabular-nums text-gray-500 dark:text-gray-400">{{ d.charges | currency:'USD':'symbol':'1.2-2' }}</div>
                  </div>
                  <span class="text-gray-400 dark:text-gray-500 transition-transform group-open:rotate-90" aria-hidden="true">›</span>
                </div>
              </summary>
              <div class="px-4 pb-4 space-y-3">
                <dl class="divide-y divide-gray-100 dark:divide-gray-700 text-sm border-t border-gray-100 dark:border-gray-700">
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ label: 'Tickets', value: d.ticketCount }" />
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ label: 'Bushels', value: d.bushels != null ? (d.bushels | number:'1.0-2') : '—' }" />
                  @if (d.unconvertedCount > 0) {
                    <div class="py-2 text-xs text-amber-700 dark:text-amber-400">{{ d.unconvertedCount }} ticket{{ d.unconvertedCount === 1 ? '' : 's' }} without a bushel conversion — not in the bushel total.</div>
                  }
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ label: 'Charges owed', value: (d.charges | currency:'USD':'symbol':'1.2-2') }" />
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ label: 'Cost per bushel', value: d.chargesPerBushel != null ? (d.chargesPerBushel * 100 | number:'1.2-2') + '¢' : '—' }" />
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ label: 'Since', value: d.since ? (d.since | date:'MMM d, y') : '—' }" />
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ label: 'Charged through', value: d.chargedThruDate ? (d.chargedThruDate | date:'MMM d, y') : '—' }" />
                  @if (d.paidThruDate) {
                    <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ label: 'Paid through', value: (d.paidThruDate | date:'MMM d, y') }" />
                  }
                </dl>
                @if (d.chargeBreakdown.length > 1) {
                  <div>
                    <h3 class="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Charges by type</h3>
                    <dl class="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
                      @for (c of d.chargeBreakdown; track c.description) {
                        <div class="flex items-baseline justify-between gap-4 py-2">
                          <dt class="min-w-0 text-gray-500 dark:text-gray-400">{{ c.description }}@if (c.rate != null) { <span class="text-xs whitespace-nowrap"> · {{ c.rate | number:'1.2-6' }}</span> }</dt>
                          <dd class="text-right font-medium tabular-nums text-gray-900 dark:text-gray-100">{{ c.amount | currency:'USD':'symbol':'1.2-2' }}</dd>
                        </div>
                      }
                    </dl>
                  </div>
                }
              </div>
            </details>
          </li>
        } @empty {
          <li class="text-sm text-gray-500 dark:text-gray-400">No DP contracts for this producer.</li>
        }
      </ul>
    }

    <!-- ─── Storage ─── -->
    <h2 class="mob-label mt-6 mb-1">Storage</h2>
    @if (storage.isLoading() && !storage.hasValue()) {
      <mob-spinner label="Loading storage…" [compact]="true" />
    } @else if (storage.error()) {
      <p class="text-sm text-red-700 dark:text-red-400" role="alert">Couldn't load storage right now. Try again in a minute.</p>
    } @else if (storage.hasValue()) {
      @if (storage.value().length > 0) {
        <ng-container [ngTemplateOutlet]="summary" [ngTemplateOutletContext]="{ countLabel: 'Receipts', count: storage.value().length, bushels: storageBushels(), charges: storageCharges() }" />
      }
      <ul class="mt-2 space-y-2" role="list">
        @for (s of storage.value(); track s.id) {
          <li class="mob-card p-0">
            <details class="group">
              <summary class="flex items-center justify-between gap-3 p-4 cursor-pointer list-none">
                <div class="min-w-0">
                  <div class="font-semibold text-gray-900 dark:text-white truncate">{{ s.crop }}</div>
                  <div class="text-sm text-gray-500 dark:text-gray-400 truncate">Receipt {{ s.receiptNumber }}@if (location(s); as loc) { · {{ loc }} }</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <div class="text-right">
                    <div class="font-semibold tabular-nums whitespace-nowrap text-gray-900 dark:text-white">{{ s.bushels | number:'1.0-0' }} bu</div>
                    @if (s.receivableAmount != null) { <div class="text-sm tabular-nums text-gray-500 dark:text-gray-400">{{ s.receivableAmount | currency:'USD':'symbol':'1.2-2' }}</div> }
                  </div>
                  <span class="text-gray-400 dark:text-gray-500 transition-transform group-open:rotate-90" aria-hidden="true">›</span>
                </div>
              </summary>
              <div class="px-4 pb-4">
                <dl class="divide-y divide-gray-100 dark:divide-gray-700 text-sm border-t border-gray-100 dark:border-gray-700">
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ label: 'Bushels', value: (s.bushels | number:'1.0-2') }" />
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ label: 'In storage since', value: s.storageStartDate ? (s.storageStartDate | date:'MMM d, y') : '—' }" />
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ label: 'Charged', value: chargedRange(s) }" />
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ label: 'Days', value: s.storageDays != null ? (s.storageDays | number:'1.0-1') : '—' }" />
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ label: 'Storage rate', value: s.storageRate != null ? (s.storageRate | number:'1.3-3') : '—' }" />
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ label: 'Charges owed', value: s.receivableAmount != null ? (s.receivableAmount | currency:'USD':'symbol':'1.2-2') : '—' }" />
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ label: 'Cost per bushel', value: costPerBushel(s) }" />
                </dl>
              </div>
            </details>
          </li>
        } @empty {
          <li class="text-sm text-gray-500 dark:text-gray-400">No grain in storage for this producer.</li>
        }
      </ul>
    }

    <!-- Section summary, like the tickets tab: count + bushels, with charges owed underneath. -->
    <ng-template #summary let-countLabel="countLabel" let-count="count" let-bushels="bushels" let-charges="charges">
      <div class="mob-card">
        <div class="flex justify-between">
          <div>
            <div class="mob-label">{{ countLabel }}</div>
            <div class="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{{ count | number }}</div>
          </div>
          <div class="text-right">
            <div class="mob-label">Bushels</div>
            <div class="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{{ bushels | number:'1.0-0' }}</div>
          </div>
        </div>
        <div class="mt-3 pt-3 flex items-baseline justify-between border-t border-gray-100 dark:border-gray-700 text-sm">
          <span class="text-gray-500 dark:text-gray-400">Charges owed</span>
          <span class="font-semibold tabular-nums text-gray-900 dark:text-white">{{ charges | currency:'USD':'symbol':'1.2-2' }}</span>
        </div>
      </div>
    </ng-template>

    <ng-template #row let-label="label" let-value="value">
      <div class="flex items-baseline justify-between gap-4 py-2">
        <dt class="text-gray-500 dark:text-gray-400">{{ label }}</dt>
        <dd class="text-right font-medium tabular-nums text-gray-900 dark:text-gray-100">{{ value }}</dd>
      </div>
    </ng-template>
  `,
})
export class StorageTab {
  private readonly api = inject(MobileApiService);
  readonly customerId = input.required<number>();

  protected readonly storage = resource<StorageCard[], number>({
    params: () => this.customerId(),
    loader: ({ params }) => this.api.getStorageCards(params),
  });

  protected readonly dp = resource<DpContractCard[], number>({
    params: () => this.customerId(),
    loader: ({ params }) => this.api.getDpContractCards(params),
  });

  protected readonly storageBushels = computed(() =>
    this.storage.hasValue() ? this.storage.value().reduce((sum, s) => sum + (s.bushels ?? 0), 0) : 0,
  );
  protected readonly storageCharges = computed(() =>
    this.storage.hasValue() ? this.storage.value().reduce((sum, s) => sum + (s.receivableAmount ?? 0), 0) : 0,
  );

  /** Each card's bushels are already counted once per delivery on the server; unconverted ones are left out. */
  protected readonly dpBushels = computed(() =>
    this.dp.hasValue() ? this.dp.value().reduce((sum, d) => sum + (d.bushels ?? 0), 0) : 0,
  );
  protected readonly dpCharges = computed(() =>
    this.dp.hasValue() ? this.dp.value().reduce((sum, d) => sum + d.charges, 0) : 0,
  );

  protected location(s: StorageCard): string {
    return [s.locationCity, s.locationState].filter((p) => !!p).join(', ');
  }

  protected chargedRange(s: StorageCard): string {
    const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (s.chargedFromDate && s.chargedThruDate) return `${fmt(s.chargedFromDate)} – ${fmt(s.chargedThruDate)}`;
    if (s.chargedThruDate) return `through ${fmt(s.chargedThruDate)}`;
    return '—';
  }

  /** The desktop's ¢/bu: charges ÷ bushels. */
  protected costPerBushel(s: StorageCard): string {
    if (s.receivableAmount == null || !s.bushels) return '—';
    return `${((s.receivableAmount / s.bushels) * 100).toFixed(2)}¢`;
  }
}
