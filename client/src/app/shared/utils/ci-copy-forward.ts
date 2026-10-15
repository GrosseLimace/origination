import { FdCicCrop, FieldSeason } from '@models';

/** The practice inputs carried from one season of a field to the next. */
export type CopyablePractices = Pick<FieldSeason, 'expectedYield' | 'syntheticN' | 'niFraction' | 'tillage' | 'coverCrop' | 'manure'>;

/**
 * What "copy last year's practices" carries onto a field for this year's crop.
 *
 * Same crop: everything. Different crop (soybeans last year, corn this year): only tillage and cover
 * crop, which describe the field rather than the crop. Yield, nitrogen, inhibitor and manure are
 * crop-specific — soybeans' 0 lbs N copied onto corn would quietly understate the corn's CI — so they
 * are left blank for the originator to fill in.
 */
export function practicesToCopy(prior: CopyablePractices, priorCrop: FdCicCrop, targetCrop: FdCicCrop): Partial<CopyablePractices> {
  if (priorCrop === targetCrop) {
    return { ...prior, manure: prior.manure.map(m => ({ ...m })) };
  }
  return { tillage: prior.tillage, coverCrop: prior.coverCrop };
}

/** Whether a copy from priorCrop carries everything or only the field-level practices. */
export function copiesAllPractices(priorCrop: FdCicCrop, targetCrop: FdCicCrop): boolean {
  return priorCrop === targetCrop;
}
