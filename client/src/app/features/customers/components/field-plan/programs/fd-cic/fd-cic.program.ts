import { FdCicData, FdCicScore, FieldProgramRecord, FieldSeason, ProducerField, ProgramScore } from '@models';
import { FdCicApiService } from '@core/services/fd-cic-api.service';
import { practicesToCopy } from '@shared/utils/ci-copy-forward';
import { environment } from '@env/environment';
import { RowSummary, SustainabilityProgramDef } from '../program-def';
import { FdCicIntakeComponent } from './fd-cic-intake.component';
import { COVER_LABELS, TILLAGE_LABELS, fdCicCropFor, fdCicScoreState, missingInputs } from './fd-cic.data';

export const FD_CIC_PROGRAM_KEY = '45z-fdcic';

const toProgramScore = (s: FdCicScore): ProgramScore =>
  ({ value: s.ci!, unit: 'g CO₂e/bu', unitShort: 'g/bu', vsBaseline: s.changeFraction ?? undefined });

/**
 * 45Z: the field's feedstock carbon intensity, scored on the API with the USDA FD-CIC calculator, for
 * 45Z biofuel programs (Pratt Energy, White Energy Plainview). Inputs follow the workbook's Crop Inputs
 * tab; state, county and acres come from the field. Each crop year is scored with the USDA version the
 * API has set for it, and finalizing freezes the inputs, outputs and that version: the record
 * 7 CFR 2100.031 asks producers to keep.
 */
export function createFdCicProgram(api: FdCicApiService): SustainabilityProgramDef<FdCicData> {
  const scored = (data: FdCicData, season: FieldSeason, field: ProducerField): FdCicScore | null => {
    const state = fdCicScoreState(api, data, season, field);
    return state?.status === 'done' && state.score.scorable ? state.score : null;
  };

  /**
   * Fields' CIs (one crop) weighted by bushels: acres × the yield each score used. Finalized fields use
   * their frozen score. `fillToAcres` counts acres not yet in a scored field at the national average,
   * so a crop row's partial coverage never flatters it; 0 averages the scored fields only.
   */
  const weightedCi = (items: { season: FieldSeason; record: FieldProgramRecord<FdCicData>; field: ProducerField }[], fillToAcres: number): RowSummary | null => {
    const fields = items.flatMap(({ season, record, field }) => {
      const frozen = record.frozen;
      if (frozen?.score) {
        const outputs = frozen.outputs as { yieldUsed: number; nationalAverage: number };
        return [{ acres: season.acres ?? 0, yieldUsed: outputs.yieldUsed, ci: frozen.score.value, national: outputs.nationalAverage }];
      }
      const score = scored(record.data, season, field);
      return score ? [{ acres: season.acres ?? 0, yieldUsed: score.yieldForCi, ci: score.ci!, national: score.nationalAverage }] : [];
    });
    if (fields.length === 0) return null;

    const national = fields[0].national;
    const scoredAcres = fields.reduce((sum, f) => sum + f.acres, 0);
    const scoredBu = fields.reduce((sum, f) => sum + f.acres * f.yieldUsed, 0);
    if (scoredBu <= 0) return null;
    const unassignedBu = Math.max(fillToAcres - scoredAcres, 0) * (scoredBu / scoredAcres);
    const ci = (fields.reduce((sum, f) => sum + f.ci * f.acres * f.yieldUsed, 0) + national * unassignedBu) / (scoredBu + unassignedBu);
    const vs = ci / national - 1;
    const pct = `${vs <= 0 ? '▼' : '▲'}${Math.abs(Math.round(vs * 100))}%`;
    return {
      text: `CI ${Math.round(ci).toLocaleString()} g/bu`,
      short: `CI ${Math.round(ci).toLocaleString()}`,
      change: { text: `${pct} vs national`, short: pct, better: vs <= 0 },
    };
  };

  return {
    key: FD_CIC_PROGRAM_KEY,
    label: '45Z clean fuel credit (USDA FD-CIC)',
    shortLabel: '45Z',
    description: 'Feedstock carbon intensity from the USDA FD-CIC calculator, for 45Z biofuel programs.',

    appliesTo: cropLabel => environment.carbonIntensityEnabled && fdCicCropFor(cropLabel) !== null,

    // The workbook's defaults: no cover crop, "None of the above" tillage, no inhibitor, no manure.
    blankData: () => ({
      expectedYield: null, actualYield: null, syntheticN: null, niFraction: 0,
      coverCrop: 'None', tillage: 'NoneOfTheAbove', manure: [],
    }),

    copyForward(prior, priorCropLabel, cropLabel) {
      const from = fdCicCropFor(priorCropLabel);
      const to = fdCicCropFor(cropLabel);
      return from && to ? practicesToCopy(prior, from, to) : null;
    },

    missing: (data, season) => missingInputs(data, season),

    preview(data, season, field) {
      const score = scored(data, season, field);
      return score ? toProgramScore(score) : null;
    },

    previewNote(data, season, field) {
      const state = fdCicScoreState(api, data, season, field);
      if (!state) return null;
      if (state.status === 'loading') return 'calculating…';
      if (state.status === 'error') return 'can\'t score';
      return state.score.scorable ? null : 'no USDA data';
    },

    /** The field's production: acres × actual yield. */
    production: (data, season) => (data.actualYield && season.acres ? data.actualYield * season.acres : null),

    finalizeMissing(data, season, field) {
      const missing = missingInputs(data, season);
      if (!data.actualYield || data.actualYield <= 0) missing.push('actual yield');
      if (missing.length > 0) return missing;
      const state = fdCicScoreState(api, data, season, field);
      if (state?.status === 'loading') return ['the USDA score (still calculating)'];
      if (state?.status === 'error') return [`a USDA score (${state.message})`];
      if (state?.status === 'done' && !state.score.scorable) return [`a USDA score (${state.score.unscorableReason})`];
      return [];
    },

    freeze(data: FdCicData, season: FieldSeason, field: ProducerField) {
      const score = scored(data, season, field);
      if (!score) throw new Error('A 45Z record can only be frozen once the USDA calculator has scored it.');
      return {
        inputs: {
          crop: season.cropLabel, fdCicCrop: fdCicCropFor(season.cropLabel), cropYear: season.year, field: field.name,
          fsaFarmNo: field.fsaFarmNo, fsaTractNo: field.fsaTractNo, fsaFieldNo: field.fsaFieldNo,
          state: field.state, county: field.county, acres: season.acres,
          expectedYield: data.expectedYield, actualYield: data.actualYield,
          syntheticN: data.syntheticN, niPercent: Math.round(data.niFraction * 100),
          coverCrop: COVER_LABELS[data.coverCrop], tillage: TILLAGE_LABELS[data.tillage],
          manure: data.manure.map(m => ({ ...m })),
        },
        outputs: {
          ciGPerBu: score.ci, nationalAverage: score.nationalAverage, vsNational: score.changeFraction,
          yieldUsed: score.yieldForCi, mlra: score.mlra, components: { ...score.components },
          usdaVersion: score.version, usdaWorkbookSha256: score.sourceSha256, usdaFormulaFingerprint: score.formulaFingerprint,
        },
        score: toProgramScore(score),
        calculatorVersion: score.label,
      };
    },

    /**
     * The crop row's CI: bushel-weighted across the scored fields, with acres not yet in a scored field
     * counted at the national average (so partial coverage never flatters the row). Finalized fields
     * use their frozen score.
     */
    rowSummary(items, intention) {
      return weightedCi(items, intention.acres);
    },

    /**
     * The producer's CI for the year across every field in 45Z, bushel-weighted over the scored fields.
     * One figure per crop: corn and soybean CIs are different feedstocks with different national
     * averages, so they are never averaged together. The crop is named only when there's more than one.
     */
    enrollmentSummary(items) {
      const byCrop = new Map<string, typeof items>();
      for (const item of items) {
        const crop = fdCicCropFor(item.season.cropLabel);
        if (crop) byCrop.set(crop, [...(byCrop.get(crop) ?? []), item]);
      }
      return [...byCrop].flatMap(([crop, group]) => {
        const summary = weightedCi(group, 0);
        if (!summary) return [];
        // Several crops: name each ("Corn CI 2,874 g/bu", short "Corn 2,874"); one crop: just "CI".
        return [byCrop.size > 1
          ? { ...summary, text: `${crop} ${summary.text}`, short: summary.short?.replace(/^CI/, crop) }
          : summary];
      });
    },

    // A getter, so the program and its form can import each other without a load-order trap.
    get intake() { return FdCicIntakeComponent; },

    enrollment: {
      idPrefix: 'CI',
      statements: [
        { key: 'notEnrolledElsewhere', short: '"not enrolled elsewhere" confirmation',
          label: 'None of these fields is enrolled with another buyer or program for this crop year.' },
        { key: 'recordsAccurate', short: '"records are accurate" confirmation',
          label: 'The practices and yields provided are accurate, and the producer keeps the records behind them.' },
        { key: 'consentToThirdPartyAudit', short: 'consent to third-party audit',
          label: 'Scoular, the receiving plant and a third-party auditor may review the supporting records.' },
        { key: 'firstPointOfAggregationAck', short: 'first-point-of-aggregation acknowledgment',
          label: 'Scoular, as first point of aggregation, holds and allocates the CI of this grain; the producer makes no other claim on it.' },
      ],
      attestedNote: 'Delivery lots in the CI ledger point back to this ID.',
    },
  };
}
