import { FdCicData, FdCicScore, FieldProgramRecord, FieldSeason, ProducerField, ProgramScore } from '@models';
import { FdCicApiService } from '@core/services/fd-cic-api.service';
import { practicesToCopy } from '@shared/utils/ci-copy-forward';
import { environment } from '@env/environment';
import { FieldResult, SustainabilityProgramDef } from '../program-def';
import { FdCicIntakeComponent } from './fd-cic-intake.component';
import { COVER_LABELS, TILLAGE_LABELS, fdCicCropFor, fdCicScoreState, missingInputs } from './fd-cic.data';

export const FD_CIC_PROGRAM_KEY = '45z-fdcic';

const toProgramScore = (s: FdCicScore): ProgramScore =>
  ({ value: s.ci!, unit: 'g CO₂e/bu', unitShort: 'g/bu' });

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

  type Item = { season: FieldSeason; record: FieldProgramRecord<FdCicData>; field: ProducerField };

  /**
   * A field's CI and bushels. A locked field uses its frozen score, acres and actual yield. Otherwise the
   * API's score, with acres × actual yield once it's in, or acres × expected yield (projected) before.
   */
  const fieldResult = ({ season, record, field }: Item): FieldResult => {
    const group = fdCicCropFor(season.cropLabel) ?? season.cropLabel;
    const frozen = record.frozen;
    if (frozen?.score) {
      const inputs = frozen.inputs as { acres?: number | null; actualYield?: number | null };
      const bushels = inputs.acres && inputs.actualYield ? inputs.acres * inputs.actualYield : null;
      return { recordId: record.id, group, value: frozen.score.value, unitShort: 'g/bu', bushels, projected: false };
    }
    const score = scored(record.data, season, field);
    const acres = season.acres ?? 0;
    const { actualYield, expectedYield } = record.data;
    const bushels = acres && actualYield ? acres * actualYield : acres && expectedYield ? acres * expectedYield : null;
    return { recordId: record.id, group, value: score?.ci ?? null, unitShort: 'g/bu', bushels, projected: !actualYield };
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
          splitId: field.splitId, splitPercent: field.splitPercent,
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
     * The crop row: the range of its fields' CIs and their bushels, never an average, e.g. "CI 2,034–6,100
     * g/bu · 85,000 bu (projected) · 320 of 520 ac scored". Field-level CI is what matters downstream.
     */
    rowSummary(items, intention) {
      const results = items.map(item => ({ item, result: fieldResult(item) })).filter(r => r.result.value !== null);
      if (!results.length) return null;
      const values = results.map(r => Math.round(r.result.value!));
      const low = Math.min(...values), high = Math.max(...values);
      const range = low === high ? low.toLocaleString() : `${low.toLocaleString()}–${high.toLocaleString()}`;
      const bushels = results.reduce((sum, r) => sum + (r.result.bushels ?? 0), 0);
      const projected = results.some(r => r.result.projected);
      const scoredAcres = results.reduce((sum, r) => sum + (r.item.season.acres ?? 0), 0);
      const parts = [`CI ${range} g/bu`, `${Math.round(bushels).toLocaleString()} bu${projected ? ' (projected)' : ''}`];
      if (scoredAcres < intention.acres) parts.push(`${scoredAcres.toLocaleString()} of ${intention.acres.toLocaleString()} ac scored`);
      return { text: parts.join(' · '), short: `CI ${range}` };
    },

    /** Each field's CI and bushels, grouped by crop: corn and soybean CIs are different feedstocks. */
    fieldResults(items) {
      return items.map(fieldResult);
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
