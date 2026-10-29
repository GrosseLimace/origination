import { describe, it, expect } from 'vitest';
import type { FieldProgramRecord, FieldSeason, FieldTicket, ProducerField } from '@models';
import { CONFIRMED_CI_HEADERS, confirmedCiCsv, confirmedCiFileName, confirmedCiRows } from './confirmed-ci-export';

const field: ProducerField = {
  fieldKey: 'TATOB43', splitId: 'TATOB43', customerId: 9, name: 'JARBOE WEST', splitPercent: 100, effectiveDate: '', state: 'KS', county: 'Pratt',
};
const season: FieldSeason = { id: 's1', fieldKey: 'TATOB43', plantingIntentionId: 10, year: 2026, cropLabel: 'Irrigated Corn', acres: 120 };
const ticket = (n: number, settled = false): FieldTicket => ({
  ticketKey: `k${n}`, ticketNumber: `P${n}`, blDate: `2026-10-0${n}`, location: 'Pratt, KS (PRA)', productCode: 'YC',
  contractNumber: null, cropYearMatch: 'window', netBushels: 1000 + n, settled, settledDate: settled ? '2026-11-20' : null, status: null,
});
const confirmed = (tickets: FieldTicket[]): FieldProgramRecord => ({
  id: 'r1', seasonId: 's1', programKey: '45z-fdcic', data: {}, status: 'Locked',
  official: {
    status: 'Documented', score: { value: 3070.754, unit: 'g CO₂e/bu', unitShort: 'g/bu' }, method: 'USDA FD-CIC v1.2',
    bushels: 2003, tickets, documentedBy: 'hc@scoular.com', documentedAt: '2026-11-21T15:00:00Z',
  },
});
const producer = { code: 'TATOBIN', name: 'T-A TOBIN FARMS LC' };

describe('confirmed CI export (the Bins\' mass balance ledger)', () => {
  it('should write one row per confirmed ticket, each with its field\'s confirmed CI', () => {
    const rows = confirmedCiRows(producer, [{ field, season, record: confirmed([ticket(1), ticket(2, true)]), enrollmentId: 'CI-2026-TATOB43' }]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([
      'TATOBIN', 'T-A TOBIN FARMS LC', 'TATOB43', 'JARBOE WEST', 'CI-2026-TATOB43', 2026, 'Corn',
      'P1', 'YC', '2026-10-01', 'Pratt, KS (PRA)', null, 1001, false, null,
      3070.75, 'USDA FD-CIC v1.2', 'hc@scoular.com', '2026-11-21T15:00:00Z',
    ]);
    expect(rows[1][13]).toBe(true);
    expect(rows[0]).toHaveLength(CONFIRMED_CI_HEADERS.length);
  });

  it('should leave out fields that are only estimated', () => {
    const estimate: FieldProgramRecord = { id: 'r2', seasonId: 's1', programKey: '45z-fdcic', data: {}, status: 'Locked' };

    expect(confirmedCiRows(producer, [{ field, season, record: estimate, enrollmentId: undefined }])).toEqual([]);
  });

  it('should be a CSV with the header first and settled as Y/N', () => {
    const csv = confirmedCiCsv(producer, [{ field, season, record: confirmed([ticket(1, true)]), enrollmentId: 'CI-2026-TATOB43' }]);
    const [header, line] = csv.split('\r\n');

    expect(header.startsWith('Producer code,Producer name,Split ID')).toBe(true);
    expect(line).toContain('"Pratt, KS (PRA)"');
    expect(line).toContain(',1001,Y,2026-11-20,3070.75,');
  });

  it('should name the file by producer, crop year and day', () => {
    expect(confirmedCiFileName('TATOBIN', 2026, new Date(2026, 9, 29))).toBe('45Z-confirmed-CI_TATOBIN_2026_20261029.csv');
    expect(confirmedCiFileName('A/B C', 2026, new Date(2026, 0, 2))).toBe('45Z-confirmed-CI_ABC_2026_20260102.csv');
  });
});
