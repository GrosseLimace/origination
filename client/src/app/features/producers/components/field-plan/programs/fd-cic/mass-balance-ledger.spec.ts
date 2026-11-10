import { describe, it, expect } from 'vitest';
import type { FieldProgramRecord, FieldSeason, FieldTicket, ProducerField } from '@models';
import { LEDGER_HEADERS, ledgerCsv, ledgerFileName, ledgerRows } from './mass-balance-ledger';

const field: ProducerField = {
  fieldKey: 'TATOB43', splitId: 'TATOB43', customerId: 9, name: 'JARBOE WEST', splitPercent: 100, effectiveDate: '', state: 'KS', county: 'Pratt',
};
const season: FieldSeason = { id: 's1', fieldKey: 'TATOB43', plantingIntentionId: 10, year: 2026, cropLabel: 'Irrigated Corn', acres: 120 };
const ticket = (n: number): FieldTicket => ({
  ticketKey: `k${n}`, ticketNumber: `P${n}`, blDate: `2026-10-0${n}`, location: 'Pratt, KS (PRA)', productCode: 'YC',
  contractNumber: null, cropYearMatch: 'window', netBushels: 1000 + n, settled: false, settledDate: null, status: null,
});
const confirmed = (tickets: FieldTicket[]): FieldProgramRecord => ({
  id: 'r1', seasonId: 's1', programKey: '45z-fdcic', data: {}, status: 'Locked',
  frozen: { inputs: { tillage: 'Reduced till' }, outputs: {}, calculatorVersion: 'USDA FD-CIC v1.2', basis: 'Estimate', lockedBy: 'hc', lockedAt: '' },
  official: {
    status: 'Documented', score: { value: 3070.754, unit: 'g CO₂e/bu', unitShort: 'g/bu' }, method: 'USDA FD-CIC v1.2',
    bushels: 2003, tickets, documentedBy: 'tess.tester@example.test', documentedAt: '2026-11-21T15:00:00Z',
  },
});
const producer = { code: 'TATOBIN', name: 'T-A TOBIN FARMS LC' };

describe('Mass Balance Ledger', () => {
  it('should write one row per confirmed field, not per ticket', () => {
    const rows = ledgerRows(producer, [{ field, season, record: confirmed([ticket(1), ticket(2)]), enrollmentId: 'CI-2026-TATOB43' }]);

    expect(rows).toEqual([[
      'TATOBIN', 'T-A TOBIN FARMS LC', 'TATOB43', 'JARBOE WEST', 'CI-2026-TATOB43', 2026, 'Corn', 120,
      2003, 2, 3070.75, 'Reduced till', 'USDA FD-CIC v1.2', 'tess.tester@example.test', '2026-11-21T15:00:00Z',
    ]]);
    expect(rows[0]).toHaveLength(LEDGER_HEADERS.length);
  });

  it('should show the confirming originator by name, or their sign-in on a record from before names were kept', () => {
    const named = confirmed([ticket(1)]);
    named.official!.documentedByName = 'Tess Tester';
    const confirmedBy = LEDGER_HEADERS.indexOf('Confirmed by');

    expect(ledgerRows(producer, [{ field, season, record: named, enrollmentId: 'CI-2026-TATOB43' }])[0][confirmedBy]).toBe('Tess Tester');
    expect(ledgerRows(producer, [{ field, season, record: confirmed([ticket(1)]), enrollmentId: 'CI-2026-TATOB43' }])[0][confirmedBy]).toBe('tess.tester@example.test');
  });

  it('should leave out fields that are only estimated', () => {
    const estimate: FieldProgramRecord = { id: 'r2', seasonId: 's1', programKey: '45z-fdcic', data: {}, status: 'Locked' };

    expect(ledgerRows(producer, [{ field, season, record: estimate, enrollmentId: undefined }])).toEqual([]);
  });

  it('should be a CSV with the header first', () => {
    const csv = ledgerCsv(producer, [{ field, season, record: confirmed([ticket(1)]), enrollmentId: 'CI-2026-TATOB43' }]);
    const [header, line] = csv.split('\r\n');

    expect(header.startsWith('Producer code,Producer name,Split ID')).toBe(true);
    expect(line).toContain(',Corn,120,2003,1,3070.75,Reduced till,');
  });

  it('should name the file by producer, crop year and day', () => {
    expect(ledgerFileName('TATOBIN', 2026, new Date(2026, 9, 29))).toBe('45Z-Mass-Balance-Ledger_TATOBIN_2026_20261029.csv');
    expect(ledgerFileName('A/B C', 2026, new Date(2026, 0, 2))).toBe('45Z-Mass-Balance-Ledger_ABC_2026_20260102.csv');
  });
});
