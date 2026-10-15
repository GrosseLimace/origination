import { CurrencyPipe, DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, resource, signal } from '@angular/core';

import { ContractCard, ContractDetail, MobileApiService } from '../../../core/api/mobile-api.service';
import { SpinnerComponent } from '../../../core/ui/spinner.component';
import { ContractStatus, contractDeliveryStats, contractStatus, contractStatusClass, unsettledQuantity } from '../../../core/util/contract-status';

/**
 * Card #645 — contracts as cards, not a grid. Collapsed: contract number, quantity, price, delivery date and
 * special type; no dollar value. Expanding shows the full detail. Matches the desktop contracts table
 * (user 2026-10-14): its status pills (Filled / Past Due / Active / To Arrive / Cancelled), its price badge
 * (cash price — red when unsigned — or Priced / Partial / Unpriced with basis / Deferred), amber for contracts the
 * producer has not confirmed, M/d/yy dates, and in the expanded view its delivery progress bar, Contract /
 * Pricing / Fulfillment sections and pricing lines.
 */
@Component({
  selector: 'mob-contracts-tab',
  imports: [SpinnerComponent, CurrencyPipe, DatePipe, DecimalPipe, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (cards.isLoading() && !cards.hasValue()) {
      <mob-spinner label="Loading contracts… this can take a moment when the data source is waking up." />
    } @else if (cards.error()) {
      <p class="text-sm text-red-700 dark:text-red-400" role="alert">Couldn't load contracts right now. Try again in a minute.</p>
    } @else if (cards.hasValue()) {
      @if (cards.value().length === 0) { <p class="mt-4 text-center text-sm text-gray-400 dark:text-gray-500">No open contracts.</p> }
      <ul class="space-y-3" role="list">
        @for (c of cards.value(); track c.id) {
          @let status = statusOf(c);
          @let open = expanded() === c.id;
          <li #cardEl class="rounded-lg border overflow-hidden scroll-mt-20"
              [class]="unconfirmed(c) ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-500/15' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'">
            <button type="button" class="w-full text-left p-3" (click)="toggle(c.id)" [attr.aria-expanded]="open">
              <div class="flex items-center justify-between gap-2">
                <span class="font-semibold text-gray-900 dark:text-white">{{ c.sourceContractId || c.contractNumber }}</span>
                <span class="inline-flex items-center justify-center min-w-[5.25rem] px-3 py-1 rounded-full text-xs font-medium text-white" [class]="statusClass(status)">{{ status }}</span>
              </div>
              @if (unconfirmed(c)) { <div class="mt-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">Not confirmed by producer</div> }
              <!-- Every field labelled (user 2026-10-14): Crop · Quantity · Special type, then Price · Delivery. -->
              <!-- Three even columns, left-aligned: each value starts where its label starts (user 2026-10-14). -->
              <dl class="mt-2 grid grid-cols-3 gap-x-4 gap-y-2 text-sm text-left">
                <div><dt class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Crop</dt>
                  <dd class="font-semibold text-gray-900 dark:text-gray-100">{{ c.commodityCode || c.commodityDescription || '—' }}</dd></div>
                <div><dt class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Quantity</dt>
                  <dd class="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{{ c.quantity != null ? (c.quantity | number:'1.0-2') : '—' }} <span class="text-xs font-normal text-gray-500 dark:text-gray-400">{{ unitLabel(c.unit) }}</span></dd></div>
                <div><dt class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Special type</dt>
                  <dd class="font-semibold text-gray-900 dark:text-gray-100">{{ c.specialType || '—' }}</dd></div>
                <div><dt class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Price</dt>
                  <dd><ng-container [ngTemplateOutlet]="price" [ngTemplateOutletContext]="{ $implicit: c }" /></dd></div>
                <div class="col-span-2"><dt class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Delivery</dt>
                  <dd class="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{{ c.deliveryStart ? (c.deliveryStart | date:'M/d/yy') : '—' }}@if (c.deliveryEnd && c.deliveryEnd !== c.deliveryStart) { – {{ c.deliveryEnd | date:'M/d/yy' }} }</dd></div>
              </dl>
              <div class="mt-1 text-right text-xs font-medium text-scoular-blue">{{ open ? 'Hide detail' : 'Show detail' }}</div>
            </button>

            @if (open) {
              <div class="border-t border-gray-200 dark:border-gray-700 p-3 space-y-4">
                @if (detail.isLoading()) {
                  <mob-spinner label="Loading detail…" [compact]="true" />
                } @else if (detail.error()) {
                  <p class="text-sm text-red-700 dark:text-red-400" role="alert">Couldn't load this contract's detail.</p>
                } @else if (detail.hasValue() && detail.value().id === c.id) {
                  @let d = detail.value()!;
                  @let ds = deliveryOf(d);

                  <!-- Delivery progress, as on the desktop: green delivered, gray remaining -->
                  <div>
                    <div class="flex items-baseline justify-between text-xs text-gray-600 dark:text-gray-300">
                      <span class="font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Delivery progress</span>
                      <span class="tabular-nums">{{ ds.progressPercent | number:'1.0-0' }}%</span>
                    </div>
                    <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700" role="progressbar" [attr.aria-valuenow]="ds.progressPercent" aria-valuemin="0" aria-valuemax="100">
                      <div class="h-full bg-scoular-green-accessible" [style.width.%]="ds.progressPercent"></div>
                    </div>
                    <div class="mt-1 flex justify-between text-xs tabular-nums text-gray-600 dark:text-gray-300">
                      <span>{{ ds.delivered | number:'1.0-0' }} {{ unitLabel(d.unit) }} delivered</span>
                      <span>{{ ds.remaining | number:'1.0-0' }} {{ unitLabel(d.unit) }} remaining</span>
                    </div>
                  </div>

                  <ng-container [ngTemplateOutlet]="section" [ngTemplateOutletContext]="{ title: 'Contract', rows: [
                    ['Contract number', d.contractNumber || '—'],
                    ['Contract date', d.contractDate ? (d.contractDate | date:'M/d/yyyy') : '—'],
                    ['Delivery period', (d.deliveryStart ? (d.deliveryStart | date:'M/d/yyyy') : '—') + ' – ' + (d.deliveryEnd ? (d.deliveryEnd | date:'M/d/yyyy') : '—')],
                    ['Unit', d.unit || '—'],
                    ['Crop year', d.cropYear ?? '—']
                  ] }" />

                  <div>
                    <h3 class="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Pricing</h3>
                    <dl class="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
                      <div class="flex items-baseline justify-between gap-4 py-2"><dt class="text-gray-500 dark:text-gray-400">Price</dt><dd class="text-right"><ng-container [ngTemplateOutlet]="price" [ngTemplateOutletContext]="{ $implicit: d }" /></dd></div>
                      @if (d.unpricedQuantity != null) {
                        <div class="flex items-baseline justify-between gap-4 py-2"><dt class="text-gray-500 dark:text-gray-400">Unpriced quantity</dt><dd class="text-right font-medium tabular-nums text-gray-900 dark:text-gray-100">{{ d.unpricedQuantity | number:'1.0-2' }} {{ unitLabel(d.unit) }}</dd></div>
                      }
                      <div class="flex items-baseline justify-between gap-4 py-2"><dt class="text-gray-500 dark:text-gray-400">Market zone</dt><dd class="text-right font-medium tabular-nums text-gray-900 dark:text-gray-100">{{ d.marketZone || '—' }}</dd></div>
                      <div class="flex items-baseline justify-between gap-4 py-2"><dt class="text-gray-500 dark:text-gray-400">Basis location</dt><dd class="text-right font-medium tabular-nums text-gray-900 dark:text-gray-100">{{ d.basisLocation || '—' }}</dd></div>
                      <div class="flex items-baseline justify-between gap-4 py-2"><dt class="text-gray-500 dark:text-gray-400">Hedge month</dt><dd class="text-right font-medium tabular-nums text-gray-900 dark:text-gray-100">{{ d.hedgeMarketMonth || '—' }}</dd></div>
                      <div class="flex items-baseline justify-between gap-4 py-2"><dt class="text-gray-500 dark:text-gray-400">Producer confirmed</dt><dd class="text-right font-medium tabular-nums text-gray-900 dark:text-gray-100">{{ d.customerConfirmStatus || '—' }}</dd></div>
                    </dl>
                  </div>

                  <ng-container [ngTemplateOutlet]="section" [ngTemplateOutletContext]="{ title: 'Fulfillment', rows: [
                    ['Total delivered', (ds.delivered | number:'1.0-2') + ' ' + unitLabel(d.unit)],
                    ['Remaining', (ds.remaining | number:'1.0-2') + ' ' + unitLabel(d.unit)],
                    ['Unsettled', unsettledOf(d) != null ? (unsettledOf(d) | number:'1.0-2') + ' ' + unitLabel(d.unit) : '—'],
                    ['Settled', d.settledQuantity != null ? (d.settledQuantity | number:'1.0-2') + ' ' + unitLabel(d.unit) : '—']
                  ] }" />

                  @if (d.pricingLines.length > 0) {
                    <div>
                      <h3 class="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Pricing lines ({{ d.pricingLines.length }})</h3>
                      <ul class="space-y-2" role="list">
                        @for (l of d.pricingLines; track $index) {
                          <li class="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm">
                            <div class="flex items-baseline justify-between gap-2">
                              <span class="text-gray-500 dark:text-gray-400">Sequence {{ l.sequence ?? '—' }}</span>
                              <span class="tabular-nums text-gray-900 dark:text-gray-100">{{ l.quantity != null ? (l.quantity | number:'1.0-2') : '—' }} {{ unitLabel(d.unit) }}</span>
                            </div>
                            <dl class="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1">
                              <div class="flex justify-between gap-2"><dt class="text-gray-500 dark:text-gray-400">Flat</dt><dd class="font-medium tabular-nums text-gray-900 dark:text-gray-100">{{ l.flatPrice != null ? (l.flatPrice | currency:'USD':'symbol':'1.2-6') : '—' }}</dd></div>
                              <div class="flex justify-between gap-2"><dt class="text-gray-500 dark:text-gray-400">Basis</dt><dd class="font-medium tabular-nums text-gray-900 dark:text-gray-100">{{ l.basisPrice != null ? (l.basisPrice | currency:'USD':'symbol':'1.2-6') : '—' }}</dd></div>
                              <div class="flex justify-between gap-2"><dt class="text-gray-500 dark:text-gray-400">Hedge</dt><dd class="font-medium tabular-nums text-gray-900 dark:text-gray-100">{{ l.hedgePrice != null ? (l.hedgePrice | currency:'USD':'symbol':'1.2-6') : '—' }}</dd></div>
                              <div class="flex justify-between gap-2"><dt class="text-gray-500 dark:text-gray-400">Freight</dt><dd class="font-medium tabular-nums text-gray-900 dark:text-gray-100">{{ l.freightAdjustment != null ? (l.freightAdjustment | currency:'USD':'symbol':'1.2-4') : '—' }}</dd></div>
                              <div class="flex justify-between gap-2"><dt class="text-gray-500 dark:text-gray-400">Date</dt><dd class="font-medium tabular-nums text-gray-900 dark:text-gray-100">{{ l.priceDate ? (l.priceDate | date:'M/d/yyyy') : '—' }}</dd></div>
                              <div class="flex justify-between gap-2"><dt class="text-gray-500 dark:text-gray-400">Confirmed</dt><dd class="truncate font-medium text-gray-900 dark:text-gray-100">{{ l.status || '—' }}</dd></div>
                            </dl>
                          </li>
                        }
                      </ul>
                    </div>
                  }
                  <!-- At the bottom too, so a long detail can be closed without scrolling back up (user 2026-10-14). Shown only once the detail has loaded. -->
                  <button type="button" class="w-full min-h-11 rounded-md border border-gray-200 dark:border-gray-700 text-sm font-medium text-scoular-blue active:bg-gray-50 dark:active:bg-gray-700"
                          (click)="hideDetail(cardEl)">Hide detail ▲</button>
                }
              </div>
            }
          </li>
        }
      </ul>
    }

    <!-- The desktop's price cell: cash price (red when unsigned), else a badge. -->
    <ng-template #price let-c>
      @switch (c.pricingStatus) {
        @case ('Flat') {
          @if (c.cashPrice != null) {
            <span class="font-semibold tabular-nums" [class]="!c.signed ? 'text-scoular-red-accessible dark:text-scoular-red' : 'text-gray-900 dark:text-gray-100'">{{ c.cashPrice | currency:'USD':'symbol':'1.2-6' }}/{{ unitSingular(c.unit) }}</span>
          } @else { <span class="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Priced</span> }
        }
        @case ('Priced') { <span class="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Priced</span> }
        @case ('Partial') { <span class="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-scoular-yellow/10 text-scoular-yellow dark:bg-scoular-yellow/20">Partial</span> }
        @case ('Deferred') { <span class="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Deferred</span> }
        @default {
          @if (c.basisPrice != null) {
            <!-- Unpriced with a locked-in basis: plain text, not a grey pill (hard to read on a phone — user 2026-10-14). -->
            <span class="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{{ c.basisPrice | currency:'USD':'symbol':'1.2-2' }}/{{ unitSingular(c.unit) }}</span>
            <span class="ml-1 text-xs text-gray-500 dark:text-gray-400">basis</span>
          } @else {
            <span class="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">Unpriced</span>
          }
        }
      }
    </ng-template>

    <ng-template #section let-title="title" let-rows="rows">
      <div>
        <h3 class="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{{ title }}</h3>
        <dl class="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
          @for (r of rows; track $index) {
            <div class="flex items-baseline justify-between gap-4 py-2"><dt class="text-gray-500 dark:text-gray-400">{{ r[0] }}</dt><dd class="text-right font-medium tabular-nums text-gray-900 dark:text-gray-100">{{ r[1] }}</dd></div>
          }
        </dl>
      </div>
    </ng-template>
  `,
})
export class ContractsTab {
  private readonly api = inject(MobileApiService);
  readonly customerId = input.required<number>();

  protected readonly expanded = signal<number | null>(null);

  /** Open contracts only (user 2026-10-14: no "Include closed" on the phone). */
  protected readonly cards = resource<ContractCard[], number>({
    params: () => this.customerId(),
    loader: ({ params }) => this.api.getContractCards(params, false),
  });

  protected readonly detail = resource<ContractDetail, { id: number; contractId: number | null }>({
    params: () => ({ id: this.customerId(), contractId: this.expanded() }),
    loader: async ({ params }) => {
      if (params.contractId === null) return undefined as unknown as ContractDetail;
      return this.api.getContractDetail(params.id, params.contractId);
    },
  });

  protected toggle(contractId: number): void {
    this.expanded.update((current) => (current === contractId ? null : contractId));
  }

  /** Bottom "Hide detail": collapse, then bring the card's top back into view (it may be far above). */
  protected hideDetail(card: HTMLElement): void {
    this.expanded.set(null);
    requestAnimationFrame(() => card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  protected statusOf(c: ContractCard): ContractStatus {
    return contractStatus(c);
  }

  protected statusClass(s: ContractStatus): string {
    return contractStatusClass(s);
  }

  protected deliveryOf(c: ContractCard) {
    return contractDeliveryStats(c);
  }

  protected unsettledOf(c: ContractCard): number | null {
    return unsettledQuantity(c);
  }

  /** The desktop highlights rows the producer has not confirmed. */
  protected unconfirmed(c: ContractCard): boolean {
    return !!c.customerConfirmStatus && c.customerConfirmStatus !== 'Confirmed';
  }

  protected unitLabel(unit: string | null | undefined): string {
    return (unit || 'bu').toLowerCase();
  }

  /** The desktop's getSingularUnit: drop a trailing "s" ("Bushels" → "Bushel"); otherwise the unit as stored. */
  protected unitSingular(unit: string | null | undefined): string {
    const u = unit || 'BU';
    return u.endsWith('s') ? u.slice(0, -1) : u;
  }
}
