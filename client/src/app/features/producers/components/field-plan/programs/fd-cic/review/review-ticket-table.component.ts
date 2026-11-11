import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FieldTicket } from '../../../../../models/field-plan.model';

/** Added in the review from outside the crop year (offered as 'other', confirmed as 'added'). */
export function isAddedTicket(t: FieldTicket): boolean {
  return t.cropYearMatch === 'other' || t.cropYearMatch === 'added';
}

/** The short tag beside a ticket's contract: how it was put in the crop year. */
export function ticketMatchLabel(t: FieldTicket): string {
  return isAddedTicket(t) ? 'added' : t.cropYearMatch === 'contract' ? 'contract yr' : 'date';
}

function ticketMatchTitle(t: FieldTicket): string {
  if (isAddedTicket(t)) return `Added by the originator${t.note ? ': ' + t.note.toLowerCase() : ''}`;
  return t.cropYearMatch === 'contract' ? 'Matched by the contract\'s crop year' : 'Matched by its BL date in the crop year window';
}

/**
 * The review's ticket table. With `pick`, each ticket has an include box (and added ones a remove link); the
 * parent keeps the selection. Without, it lists the confirmed tickets.
 */
@Component({
  selector: 'app-review-ticket-table',
  standalone: true,
  imports: [DatePipe, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './review-ticket-table.component.html',
})
export class ReviewTicketTableComponent {
  readonly rows = input.required<readonly FieldTicket[]>();
  /** Show include boxes; the parent keeps which are left out. */
  readonly pick = input(false);
  readonly excluded = input<ReadonlySet<string>>(new Set());
  readonly allIncluded = input(false);
  readonly someIncluded = input(false);
  /** Whether any row can be counted; with none, the header box is disabled. */
  readonly anyCountable = input(true);
  readonly includedCount = input(0);
  /** The footer total: the included bushels when picking, else every row's. */
  readonly bushels = input(0);

  readonly toggle = output<string>();
  readonly toggleAll = output<void>();
  readonly removeAdded = output<string>();

  readonly isAdded = isAddedTicket;
  readonly matchLabel = ticketMatchLabel;
  readonly matchTitle = ticketMatchTitle;
}
