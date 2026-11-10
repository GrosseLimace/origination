import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { KEEP_YEARS, RECORD_FORMS, RecordkeepingGroup } from '../fd-cic-recordkeeping';

/** The records a producer keeps for a field, grouped by the practice that needs them. */
@Component({
  selector: 'app-review-recordkeeping',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './review-recordkeeping.component.html',
})
export class ReviewRecordkeepingComponent {
  readonly groups = input.required<readonly RecordkeepingGroup[]>();
  readonly keepYears = KEEP_YEARS;
  readonly recordForms = RECORD_FORMS;
}
