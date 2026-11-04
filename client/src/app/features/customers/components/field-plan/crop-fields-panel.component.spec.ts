import { describe, it, expect } from 'vitest';
import { CtrmSplit } from '@models';
import { splitFromText, splitIdFromText } from './crop-fields-panel.component';

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

// SPLITS-GRAPHQL: split IDs typed by hand until CTRM's splits query is live.
describe('splitIdFromText (a split ID typed by hand)', () => {
  it('should take a CTRM-style code, upper-cased, from what was typed', () => {
    expect(splitIdFromText(' tatob43 ')).toBe('TATOB43');
    expect(splitIdFromText('TATOB43 · JARBOE WEST')).toBe('TATOB43');
    expect(splitIdFromText('A1')).toBe('A1');
  });

  it('should refuse what CTRM couldn\'t hold: over 7 characters, punctuation, or nothing', () => {
    expect(splitIdFromText('TATOB430')).toBeUndefined();
    expect(splitIdFromText('TA-TOB')).toBeUndefined();
    expect(splitIdFromText('  ')).toBeUndefined();
  });
});
