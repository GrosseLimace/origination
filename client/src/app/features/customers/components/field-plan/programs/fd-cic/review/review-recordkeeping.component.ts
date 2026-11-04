import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { KEEP_YEARS, RECORD_FORMS, RecordkeepingGroup } from '../fd-cic-recordkeeping';

/** The records a producer keeps for a field, grouped by the practice that needs them. */
@Component({
  selector: 'app-review-recordkeeping',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<p class="mt-1 text-sm text-gray-700 dark:text-gray-300">
  Go over these with the producer. They keep them for {{ keepYears }} years and show them to an auditor if asked.
</p>
<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ recordForms }}</p>
<div class="mt-3 grid gap-3 sm:grid-cols-2">
  @for (g of groups(); track g.key) {
    <section class="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2">
      <h5 class="text-sm font-semibold text-gray-900 dark:text-white">{{ g.title }}</h5>
      <ul class="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700 dark:text-gray-300">
        @for (item of g.items; track item) { <li>{{ item }}</li> }
      </ul>
    </section>
  }
</div>
`,
})
export class ReviewRecordkeepingComponent {
  readonly groups = input.required<readonly RecordkeepingGroup[]>();
  readonly keepYears = KEEP_YEARS;
  readonly recordForms = RECORD_FORMS;
}
