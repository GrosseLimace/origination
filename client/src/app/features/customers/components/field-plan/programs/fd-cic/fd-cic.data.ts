import { CoverCrop, FdCicCrop, FdCicData, FdCicScoreRequest, FdCicScoreState, FieldSeason, ProducerField, Tillage } from '@models';
import { FdCicApiService } from '@core/services/fd-cic-api.service';

/** The workbook's own labels, which the API's tables are keyed by. */
export const TILLAGE_LABELS: Record<Tillage, string> = {
  ReducedTill: 'Reduced till', NoTill: 'No till', NoneOfTheAbove: 'None of the above',
};
/** A USDA tillage label back to its key ("No till" → NoTill); null when it isn't one. */
export function tillageFromLabel(label: string | null | undefined): Tillage | null {
  return (Object.keys(TILLAGE_LABELS) as Tillage[]).find(k => TILLAGE_LABELS[k] === label) ?? null;
}
export const COVER_LABELS: Record<CoverCrop, string> = {
  CoverCrop: 'Cover crop', CoverCropGrazed: 'Cover crop with grazing', None: 'No cover crop',
};

/** Maps a planting row's crop label ("Irrigated Corn", "Organic Soybeans", "Milo") to an FD-CIC crop, or null. */
export function fdCicCropFor(cropLabel: string): FdCicCrop | null {
  const label = cropLabel.toLowerCase();
  if (label.includes('popcorn')) return null;
  if (label.includes('corn')) return 'Corn';
  if (label.includes('soy')) return 'Soybean';
  if (label.includes('sorghum') || label.includes('milo')) return 'Sorghum';
  if (label.includes('canola')) return 'Canola';
  return null;
}

/** The inputs a field still needs before it can be scored, in form order. */
export function missingInputs(data: FdCicData, season: Pick<FieldSeason, 'acres'>): string[] {
  const missing: string[] = [];
  if (!season.acres || season.acres <= 0) missing.push('acres');
  if (!data.expectedYield || data.expectedYield <= 0) missing.push('expected yield');
  if (data.syntheticN === null || data.syntheticN < 0) missing.push('nitrogen rate');
  return missing;
}

/**
 * The API request for one field, or null while it can't be scored yet (missing inputs, a crop USDA
 * doesn't score, or a field without a county). Manure rows still being filled in count as zero.
 */
export function fdCicRequest(data: FdCicData, season: FieldSeason, field: ProducerField): FdCicScoreRequest | null {
  const crop = fdCicCropFor(season.cropLabel);
  if (!crop || !field.state || !field.county || missingInputs(data, season).length > 0) return null;
  return {
    crop,
    state: field.state,
    county: field.county,
    actualYield: data.actualYield && data.actualYield > 0 ? data.actualYield : null,
    expectedYield: data.expectedYield!,
    syntheticN: data.syntheticN!,
    niFraction: data.niFraction,
    coverCrop: COVER_LABELS[data.coverCrop],
    tillage: TILLAGE_LABELS[data.tillage],
    manure: data.manure.map(m => ({ amount: m.amount ?? 0, nContent: m.nContent ?? 0 })),
  };
}

/** A field's score from the API, for the crop year of its season. Null while it can't be requested yet. */
export function fdCicScoreState(api: FdCicApiService, data: FdCicData, season: FieldSeason, field: ProducerField): FdCicScoreState | null {
  const request = fdCicRequest(data, season, field);
  return request ? api.score(season.year, request) : null;
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
