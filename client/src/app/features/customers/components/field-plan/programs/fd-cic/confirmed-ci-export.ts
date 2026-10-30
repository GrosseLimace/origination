import { FieldProgramRecord, FieldSeason, ProducerField } from '@models';
import { CsvCell, toCsv } from '@shared/utils/csv';
import { fdCicCropFor } from './fd-cic.data';

/** A confirmed 45Z field, ready to export. */
export interface ConfirmedCiField {
  field: ProducerField;
  season: FieldSeason;
  record: FieldProgramRecord;
  enrollmentId: string | undefined;
}

/**
 * The Bins' mass balance ledger file: one row per confirmed ticket, each carrying its field's confirmed CI,
 * so the ledger can post the receipts with their CI. Only confirmed fields (an official result with
 * tickets) contribute; estimates never do.
 */
export const CONFIRMED_CI_HEADERS = [
  'Producer code', 'Producer name', 'Split ID', 'Field', 'Enrollment ID', 'Crop year', 'Commodity',
  'Ticket #', 'Product code', 'BL date', 'Location', 'Contract #', 'Crop year by', 'Net bushels', 'Settled', 'Settled date',
  'CI (g CO2e/bu)', 'USDA version', 'Confirmed by', 'Confirmed at',
] as const;

/** How each ticket was put in the crop year, for the ledger's audit trail. */
const CROP_YEAR_BY: Readonly<Record<string, string>> = {
  contract: 'Contract year', window: 'BL date window', added: 'Added in review',
};

export function confirmedCiRows(producer: { code: string; name: string }, fields: readonly ConfirmedCiField[]): CsvCell[][] {
  const rows: CsvCell[][] = [];
  for (const { field, season, record, enrollmentId } of fields) {
    const official = record.official;
    if (official?.status !== 'Documented' || !official.tickets?.length) continue;
    const ci = official.score ? Math.round(official.score.value * 100) / 100 : null;
    for (const t of official.tickets) {
      rows.push([
        producer.code, producer.name, field.splitId, field.name, enrollmentId ?? '', season.year,
        fdCicCropFor(season.cropLabel) ?? season.cropLabel,
        t.ticketNumber, t.productCode, t.blDate, t.location, t.contractNumber, CROP_YEAR_BY[t.cropYearMatch] ?? t.cropYearMatch, t.netBushels, t.settled, t.settledDate,
        ci, official.method, official.documentedBy, official.documentedAt,
      ]);
    }
  }
  return rows;
}

export function confirmedCiCsv(producer: { code: string; name: string }, fields: readonly ConfirmedCiField[]): string {
  return toCsv(CONFIRMED_CI_HEADERS, confirmedCiRows(producer, fields));
}

/** e.g. "45Z-confirmed-CI_TATOBIN_2026_20261029.csv". */
export function confirmedCiFileName(producerCode: string, cropYear: number, at: Date): string {
  const day = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}`;
  const code = producerCode.replace(/[^A-Za-z0-9]/g, '') || 'producer';
  return `45Z-confirmed-CI_${code}_${cropYear}_${day}.csv`;
}
