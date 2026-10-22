import { Injectable } from '@angular/core';
import { CtrmSplit, Customer } from '@models';

const SAMPLE: { field: string; pct: number; date: string; kind?: CtrmSplit['kind']; expired?: boolean }[] = [
  { field: 'NORTH 80', pct: 100, date: '2018-10-01' },
  { field: 'HOME PLACE IRR', pct: 100, date: '2018-10-15' },
  { field: 'SOUTH PIVOT IRR', pct: 50, date: '2024-09-01' },
  { field: 'RIVER BOTTOM DRY', pct: 66.667, date: '2018-12-01' },
  { field: 'WEST QUARTER DRY', pct: 100, date: '2019-09-01' },
  { field: 'ANDERSON', pct: 66.667, date: '2020-11-01' },
  { field: 'BIN', pct: 100, date: '2024-09-01', kind: 'Bin' },
  { field: 'OLD HOME 40', pct: 100, date: '2016-10-01', expired: true },
];

/**
 * PROTOTYPE ONLY: stands in for CTRM's Customer Splits Inquiry — a producer's combined customer
 * (split) IDs, one per field, which tickets are delivered under. Returns the same made-up list for
 * every producer, built from the producer's CTRM code (e.g. TATOBIN → TATOB01…). The real source is
 * the CTRM splits table, read through GraphQL or an ODS view, once it's identified.
 */
@Injectable({ providedIn: 'root' })
export class CtrmSplitMockService {
  /** Every split under the producer, including bin-site and expired ones. */
  splitsFor(customer: Pick<Customer, 'scoularId' | 'name'>): CtrmSplit[] {
    const primary = (customer.scoularId || customer.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 7)).toUpperCase();
    const prefix = primary.slice(0, 5);
    const owner = customer.name.toUpperCase();
    return SAMPLE.map((s, i) => ({
      splitId: `${prefix}${String(i + 1).padStart(2, '0')}`,
      primaryCustomerId: primary,
      name: `${owner} - ${s.field}`,
      fieldName: s.field,
      splitPercent: s.pct,
      effectiveDate: s.date,
      expired: !!s.expired,
      kind: s.kind ?? 'Field',
    }));
  }
}
