import { FdCicCrop, FieldSeason } from '@models';

/** The practice inputs carried from one season of a field to the next. */
export type CopyablePractices = Pick<FieldSeason, 'expectedYield' | 'syntheticN' | 'niFraction' | 'tillage' | 'coverCrop' | 'manure'>
  & Partial<Pick<FieldSeason, 'nApplications' | 'noNApplied' | 'phosphateLbs' | 'potashLbs' | 'limeTons' | 'energy'>>;

/**
 * What "copy last year's practices" carries onto a field for this year's crop.
 *
 * Same crop: everything. Different crop (soybeans last year, corn this year): only tillage and cover
 * crop, which describe the field rather than the crop. Yield, nitrogen, inhibitor and manure are
 * crop-specific — soybeans' 0 lbs N copied onto corn would quietly understate the corn's CI — so they
 * are left blank for the originator to fill in. Evidence, actual yield and the frozen score are
 * never copied: they belong to the year they were recorded in.
 */
export function practicesToCopy(prior: CopyablePractices, priorCrop: FdCicCrop, targetCrop: FdCicCrop): Partial<CopyablePractices> {
  if (priorCrop === targetCrop) {
    const {
      expectedYield, syntheticN, niFraction, tillage, coverCrop, manure,
      nApplications, noNApplied, phosphateLbs, potashLbs, limeTons, energy,
    } = prior;
    const copied: Partial<CopyablePractices> = { expectedYield, syntheticN, niFraction, tillage, coverCrop, manure: manure.map(m => ({ ...m })) };
    if (nApplications) Object.assign(copied, {
      nApplications: nApplications.map(a => ({ ...a })), noNApplied, phosphateLbs, potashLbs, limeTons, energy: energy && { ...energy },
    });
    return copied;
  }
  return { tillage: prior.tillage, coverCrop: prior.coverCrop };
}

/** Whether a copy from priorCrop carries everything or only the field-level practices. */
export function copiesAllPractices(priorCrop: FdCicCrop, targetCrop: FdCicCrop): boolean {
  return priorCrop === targetCrop;
}
