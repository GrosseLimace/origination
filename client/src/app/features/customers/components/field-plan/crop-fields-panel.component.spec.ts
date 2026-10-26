import { describe, it, expect } from 'vitest';
import { CtrmSplit } from '@models';
import { splitFromText } from './crop-fields-panel.component';

const split = (splitId: string, fieldName: string): CtrmSplit => ({
  splitId, fieldName, primaryCustomerId: 'TATOBIN', name: `TATOBIN - ${fieldName}`, splitPercent: 100, effectiveDate: '2018-10-01', expired: false, kind: 'Field',
});
const splits = [split('TATOB02', 'HOME PLACE IRR'), split('TATOB03', 'SOUTH PIVOT IRR')];

describe('splitFromText (the add-field type-ahead)', () => {
  it('should find a split picked from the list, "ID · field name"', () => {
    expect(splitFromText('TATOB02 · HOME PLACE IRR', splits)?.splitId).toBe('TATOB02');
  });

  it('should find a split by its ID or its exact field name, in any case', () => {
    expect(splitFromText(' tatob03 ', splits)?.splitId).toBe('TATOB03');
    expect(splitFromText('south pivot irr', splits)?.splitId).toBe('TATOB03');
  });

  it('should find nothing for text that is none of the producer\'s splits', () => {
    expect(splitFromText('TATOB09', splits)).toBeUndefined();
    expect(splitFromText('SOUTH', splits)).toBeUndefined();
    expect(splitFromText('  ', splits)).toBeUndefined();
  });
});
