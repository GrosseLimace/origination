import { Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CarbonIntensityMockService } from '@core/services/carbon-intensity-mock.service';
import { FdCicCrop, PlantingIntention } from '@models';
import { summarizeIntention } from '@shared/utils/ci-illustrative';

/** The one-line 45Z summary under a planting intention row; clicking it opens the field dialog. */
@Component({
  selector: 'app-ci-intention-strip',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button type="button" (click)="open.emit()"
            class="group flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-1.5 text-left text-sm bg-transparent border border-transparent hover:border-scoular-green-accessible/40 hover:bg-scoular-green-accessible/5 dark:hover:bg-scoular-green/10 transition-colors">
      <span class="font-semibold text-scoular-green-accessible dark:text-scoular-green">🌱 45Z</span>
      @if (summary(); as s) {
        @if (s.fieldCount === 0) {
          <span class="text-gray-600 dark:text-gray-300">Not started · add fields to get a CI score</span>
        } @else {
          <span class="text-gray-700 dark:text-gray-200">
            {{ s.fieldCount }} field{{ s.fieldCount === 1 ? '' : 's' }} · {{ s.assignedAcres | number }} of {{ s.intentionAcres | number }} ac
          </span>
          @if (s.ciGPerBu !== null) {
            <span class="text-gray-700 dark:text-gray-200">· CI <span class="font-semibold">{{ s.ciGPerBu | number:'1.0-0' }}</span> g/bu</span>
            <span class="font-medium" [class]="(s.vsNational ?? 0) <= 0 ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'">
              {{ (s.vsNational ?? 0) <= 0 ? '▼' : '▲' }}{{ absPct(s.vsNational) }}% vs national
            </span>
          }
          <span class="rounded-full px-2 py-0.5 text-xs font-medium" [class]="statusClass(s.status)">{{ s.status }}</span>
        }
      }
      <span class="ml-auto text-gray-400 group-hover:text-scoular-green-accessible">›</span>
    </button>
  `,
})
export class CiIntentionStripComponent {
  private readonly ci = inject(CarbonIntensityMockService);
  readonly intention = input.required<PlantingIntention>();
  readonly crop = input.required<FdCicCrop>();
  readonly open = output<void>();

  readonly summary = computed(() =>
    summarizeIntention(this.crop(), this.intention(), this.ci.seasonsForIntention(this.intention().id)));

  absPct(fraction: number | null): number {
    return Math.abs(Math.round((fraction ?? 0) * 100));
  }

  statusClass(status: string): string {
    switch (status) {
      case 'Final': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
      case 'Projected': return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
      default: return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
    }
  }
}
