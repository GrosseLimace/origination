import { FdCicData, FieldSeason, SeasonStatus } from '@models';
import { ScorableSeason } from '@shared/utils/ci-illustrative';

/** Stamped on every finalized 45Z record. The C# port of the calculator replaces "illustrative prototype". */
export const FD_CIC_CALCULATOR_VERSION = 'USDA FD-CIC v1.2 (estimate)';

/** The scoring helpers' view of one field: the program data plus the field season's acres. */
export function fdCicScorable(data: FdCicData, season: Pick<FieldSeason, 'acres'>, status: SeasonStatus = 'Draft'): ScorableSeason {
  return { ...data, acres: season.acres, status };
}

/** The workbook's manure types, with its wording. */
export const MANURE_OPTIONS: { value: string; label: string }[] = [
  { value: 'Beef|Solid', label: 'Beef cattle manure: Solid (tons/acre)' },
  { value: 'Beef|Liquid', label: 'Beef cattle manure: Liquid (1,000 gal/acre)' },
  { value: 'Dairy|Solid', label: 'Dairy manure: Solid (tons/acre)' },
  { value: 'Dairy|Liquid', label: 'Dairy manure: Liquid (1,000 gal/acre)' },
  { value: 'Swine|Solid', label: 'Swine manure: Solid (tons/acre)' },
  { value: 'Swine|Liquid', label: 'Swine manure: Liquid (1,000 gal/acre)' },
  { value: 'Poultry|Solid', label: 'Poultry manure: Solid (tons/acre)' },
  { value: 'Poultry|Liquid', label: 'Poultry manure: Liquid (1,000 gal/acre)' },
];
