import { Injectable, signal } from '@angular/core';
import { Customer } from '@models';
import { isOrganicSectionVisible } from '../../utils/organic-visibility';

/**
 * Whether the producer gets the Organic badge: the CTRM organic industry code, or a real NOP id on file. See
 * @shared/utils/organic-visibility for why both are needed when they overlap almost completely.
 */
export function isOrganicProducer(customer: Customer | null): boolean {
  return !!customer && isOrganicSectionVisible({ industryCode2: customer.industryCode2, nopId: customer.nopId });
}

/**
 * Whether the Organic panel is open. The badge, beside the producer's name, opens it; the panel shows under the name,
 * in another slot, so the two share it here.
 */
@Injectable({ providedIn: 'root' })
export class OrganicPanelState {
  readonly open = signal(false);
}
