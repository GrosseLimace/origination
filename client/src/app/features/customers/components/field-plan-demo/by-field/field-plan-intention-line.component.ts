import { Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ByFieldMockService } from './by-field-mock.service';
import { FALLOW, FdCicCrop, PlantingIntention } from './model';
import { summarizeIntention } from '@shared/utils/ci-illustrative';
import { otherAcres, planKeyId } from './field-plan-rollup';

/**
 * The quiet line under a "By crop" row: how its acres split between fields and other acres, the 45Z
 * summary for a scored crop, and — in the prototype — what the total would become once the field
 * plan is saved. Clicking it opens "By field".
 */
@Component({
  selector: 'app-demo-byfield-line',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button type="button" (click)="open.emit()"
            class="group flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-1 text-left text-sm bg-transparent border border-transparent hover:border-scoular-green-accessible/40 hover:bg-scoular-green-accessible/5 dark:hover:bg-scoular-green/10 transition-colors">
      @if (split(); as s) {
        @if (s.fieldCount === 0) {
          <span class="text-gray-500 dark:text-gray-400">No fields yet · plan by field</span>
        } @else {
          <span class="text-gray-700 dark:text-gray-200">
            {{ s.inFields | number }} ac in {{ s.fieldCount }} field{{ s.fieldCount === 1 ? '' : 's' }} · {{ s.other | number }} other
          </span>
          @if (s.total !== intention().acres) {
            <span class="text-xs text-amber-700 dark:text-amber-400">→ {{ s.total | number }} ac when saved (prototype)</span>
          }
        }
        @if (crop() && ci(); as c) {
          @if (c.ciGPerBu !== null) {
            <span class="text-gray-700 dark:text-gray-200">· <span class="text-scoular-green-accessible dark:text-scoular-green font-semibold">🌱 45Z</span> CI <span class="font-semibold">{{ c.ciGPerBu | number:'1.0-0' }}</span> g/bu</span>
            <span class="font-medium" [class]="(c.vsNational ?? 0) <= 0 ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'">
              {{ (c.vsNational ?? 0) <= 0 ? '▼' : '▲' }}{{ absPct(c.vsNational) }}%
            </span>
          }
        }
      }
      <span class="ml-auto text-gray-400 group-hover:text-scoular-green-accessible">›</span>
    </button>
  `,
})
export class ByFieldLineComponent {
  private readonly plan = inject(ByFieldMockService);
  readonly intention = input.required<PlantingIntention>();
  /** The FD-CIC crop when this row is scored for 45Z, else null. */
  readonly crop = input<FdCicCrop | null>(null);
  readonly open = output<void>();

  /** This row's seasons: those that roll up under its key. */
  private readonly seasons = computed(() => {
    const pi = this.intention();
    const id = planKeyId({ crop: pi.crop, type: pi.type || '', year: pi.plantingYear, tradeUnit: pi.tradeUnit || '' });
    const fieldKeys = new Set(this.plan.fieldsFor(pi.customerId).map(f => f.fieldKey));
    return this.plan.seasons().filter(s =>
      s.year === pi.plantingYear && s.crop !== FALLOW && fieldKeys.has(s.fieldKey) && planKeyId(this.plan.keyFor(s)) === id);
  });

  readonly split = computed(() => {
    const pi = this.intention();
    const total = this.plan.totalForIntention(pi)?.total ?? pi.acres;
    const inFields = this.seasons().reduce((sum, s) => sum + (s.acres ?? 0), 0);
    return { fieldCount: this.seasons().length, inFields, other: otherAcres(total, inFields), total };
  });

  readonly ci = computed(() => {
    const crop = this.crop();
    if (!crop) return null;
    return summarizeIntention(crop, { id: this.intention().id, acres: this.split().total }, this.seasons());
  });

  absPct(fraction: number | null): number {
    return Math.abs(Math.round((fraction ?? 0) * 100));
  }
}
