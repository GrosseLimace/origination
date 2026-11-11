import { FieldProgramRecord, FieldSeason, ProducerField } from '../../../../models/field-plan.model';
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
 * The Mass Balance Ledger file for the Bins: one row per confirmed field, with its confirmed bushels and CI.
 * The tickets behind the bushels are counted here and listed in the field's Biofuel Feedstock Report. Only
 * confirmed fields (an official result with tickets) contribute; estimates never do.
 */
export const LEDGER_HEADERS = [
  'Producer code', 'Producer name', 'Split ID', 'Field', 'Enrollment ID', 'Crop year', 'Commodity', 'Acres',
  'Confirmed bushels', 'Tickets', 'CI (g CO2e/bu)', 'Tillage', 'USDA version', 'Confirmed by', 'Confirmed at',
] as const;

export function ledgerRows(producer: { code: string; name: string }, fields: readonly ConfirmedCiField[]): CsvCell[][] {
  return fields.flatMap(({ field, season, record, enrollmentId }): CsvCell[][] => {
    const official = record.official;
    if (official?.status !== 'Documented' || !official.tickets?.length) return [];
    const ci = official.score ? Math.round(official.score.value * 100) / 100 : null;
    const tillage = record.frozen?.inputs['tillage'];
    return [[
      producer.code, producer.name, field.splitId, field.name, enrollmentId ?? '', season.year,
      fdCicCropFor(season.cropLabel) ?? season.cropLabel, season.acres,
      official.bushels ?? null, official.tickets.length, ci, typeof tillage === 'string' ? tillage : null,
      official.method, official.documentedByName ?? official.documentedBy, official.documentedAt,
    ]];
  });
}

export function ledgerCsv(producer: { code: string; name: string }, fields: readonly ConfirmedCiField[]): string {
  return toCsv(LEDGER_HEADERS, ledgerRows(producer, fields));
}

/** e.g. "45Z-Mass-Balance-Ledger_TATOBIN_2026_20261029.csv". */
export function ledgerFileName(producerCode: string, cropYear: number, at: Date): string {
  return `45Z-Mass-Balance-Ledger_${safeCode(producerCode)}_${cropYear}_${yyyymmdd(at)}.csv`;
}

/** A local date as yyyymmdd, for file names. */
export function yyyymmdd(at: Date): string {
  return `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}`;
}

/** Letters and digits only, for file names. */
export function safeCode(code: string, fallback = 'producer'): string {
  return code.replace(/[^A-Za-z0-9-]/g, '') || fallback;
}
