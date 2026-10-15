import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CiResult } from '@models';

/**
 * One field's CI: the number, how it compares to the national average, a bar per component, and
 * the plain-language reasons it moved. Shown beside the field form so every change has a visible effect.
 */
@Component({
  selector: 'app-ci-preview-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 space-y-4">
      <div class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">This field's CI</div>

      @if (result(); as r) {
        <div>
          <div class="text-3xl font-bold text-gray-900 dark:text-white">{{ r.ciGPerBu | number:'1.0-0' }}</div>
          <div class="text-xs text-gray-500 dark:text-gray-400">g CO₂e per bushel</div>
          <div class="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-medium"
               [class]="r.vsNational <= 0 ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'">
            {{ r.vsNational <= 0 ? '▼' : '▲' }}{{ (r.vsNational < 0 ? -r.vsNational : r.vsNational) | percent:'1.0-0' }}
            {{ r.vsNational <= 0 ? 'lower' : 'higher' }} than national ({{ r.nationalAverage | number:'1.0-0' }})
          </div>
        </div>

        <div class="space-y-1.5">
          @for (c of r.components; track c.key) {
            <div>
              <div class="flex justify-between text-xs text-gray-600 dark:text-gray-300">
                <span>{{ c.label }}</span>
                <span class="tabular-nums">{{ c.value | number:'1.0-0' }}</span>
              </div>
              <div class="h-2 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div class="h-full rounded" [style.width.%]="barWidth(c.value)"
                     [class]="c.value < 0 ? 'bg-green-600' : 'bg-scoular-green-accessible'"></div>
              </div>
            </div>
          }
        </div>

        @if (r.reasons.length > 0) {
          <div>
            <div class="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">What's moving the score</div>
            <ul class="space-y-1 text-sm">
              @for (reason of r.reasons; track reason.label) {
                <li class="flex justify-between gap-2">
                  <span class="text-gray-700 dark:text-gray-300">{{ reason.label }}</span>
                  <span class="tabular-nums font-medium" [class]="reason.delta < 0 ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'">
                    {{ reason.delta < 0 ? '−' : '+' }}{{ (reason.delta < 0 ? -reason.delta : reason.delta) | number:'1.0-0' }}
                  </span>
                </li>
              }
            </ul>
          </div>
        }
        <div class="text-xs text-gray-500 dark:text-gray-400">
          Based on {{ r.yieldUsed | number:'1.0-0' }} bu/ac.
        </div>
      } @else {
        <div class="text-sm text-gray-600 dark:text-gray-300">
          Fill in the highlighted items to see this field's score.
          @if (missing().length > 0) {
            <ul class="mt-2 list-disc pl-5 text-amber-700 dark:text-amber-400">
              @for (m of missing(); track m) { <li>{{ m }}</li> }
            </ul>
          }
        </div>
      }

      <div class="rounded bg-amber-50 dark:bg-amber-900/30 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-300">
        Prototype: scores are illustrative, not the USDA calculation.
      </div>
    </div>
  `,
})
export class CiPreviewPanelComponent {
  readonly result = input<CiResult | null>(null);
  readonly missing = input<string[]>([]);

  private readonly maxComponent = computed(() =>
    Math.max(1, ...(this.result()?.components ?? []).map(c => Math.abs(c.value))));

  barWidth(value: number): number {
    return Math.round((Math.abs(value) / this.maxComponent()) * 100);
  }
}
