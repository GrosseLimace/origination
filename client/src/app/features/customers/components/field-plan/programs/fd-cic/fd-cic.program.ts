import { FdCicData, FieldProgramRecord, FieldSeason, ProducerField, SeasonStatus } from '@models';
import { COVER_LABELS, TILLAGE_LABELS, estimateCi, fdCicCropFor, missingInputs, summarizeIntention } from '@shared/utils/ci-illustrative';
import { practicesToCopy } from '@shared/utils/ci-copy-forward';
import { environment } from '@env/environment';
import { SustainabilityProgramDef } from '../program-def';
import { FdCicIntakeComponent } from './fd-cic-intake.component';
import { FD_CIC_CALCULATOR_VERSION, fdCicScorable } from './fd-cic.data';

const toStatus = (s: FieldProgramRecord['status']): SeasonStatus => (s === 'Final' ? 'Final' : s === 'Ready' ? 'Projected' : 'Draft');

/**
 * 45Z: the field's feedstock carbon intensity, scored with the USDA FD-CIC calculator, for 45Z
 * biofuel programs (Pratt Energy, White Energy Plainview). Inputs follow FD-CIC v1.2's Crop Inputs
 * tab; state, county and acres come from the field. Finalizing freezes the inputs and outputs, the
 * record 7 CFR 2100.031 asks producers to keep.
 */
export const FD_CIC_PROGRAM: SustainabilityProgramDef<FdCicData> = {
  key: '45z-fdcic',
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

  missing: (data, season) => missingInputs({ ...data, acres: season.acres }),

  preview(data, season) {
    const crop = fdCicCropFor(season.cropLabel);
    const r = crop ? estimateCi(crop, fdCicScorable(data, season)) : null;
    return r ? { value: r.ciGPerBu, unit: 'g CO₂e/bu', unitShort: 'g/bu', vsBaseline: r.vsNational } : null;
  },

  /** Bushels the field should have delivered: acres × actual yield, checked against the enrollment's tickets. */
  production: (data, season) => (data.actualYield && season.acres ? data.actualYield * season.acres : null),

  finalizeMissing(data, season) {
    const missing = missingInputs({ ...data, acres: season.acres });
    if (!data.actualYield || data.actualYield <= 0) missing.push('actual yield');
    return missing;
  },

  freeze(data: FdCicData, season: FieldSeason, field: ProducerField) {
    const crop = fdCicCropFor(season.cropLabel)!;
    const r = estimateCi(crop, fdCicScorable(data, season, 'Final'))!;
    return {
      inputs: {
        crop: season.cropLabel, fdCicCrop: crop, cropYear: season.year, field: field.name,
        fsaFarmNo: field.fsaFarmNo, fsaTractNo: field.fsaTractNo, fsaFieldNo: field.fsaFieldNo,
        state: field.state, county: field.county, acres: season.acres,
        expectedYield: data.expectedYield, actualYield: data.actualYield,
        syntheticN: data.syntheticN, niPercent: Math.round(data.niFraction * 100),
        coverCrop: COVER_LABELS[data.coverCrop], tillage: TILLAGE_LABELS[data.tillage],
        manure: data.manure.map(m => ({ ...m })),
      },
      outputs: {
        ciGPerBu: r.ciGPerBu, nationalAverage: r.nationalAverage, vsNational: r.vsNational,
        yieldUsed: r.yieldUsed, components: r.components.map(c => ({ ...c })),
      },
      score: { value: r.ciGPerBu, unit: 'g CO₂e/bu', unitShort: 'g/bu', vsBaseline: r.vsNational },
      calculatorVersion: FD_CIC_CALCULATOR_VERSION,
    };
  },

  /** The crop row's CI: bushel-weighted, with acres not yet in a field at the national average. */
  rowSummary(items, intention) {
    const crop = items.length ? fdCicCropFor(items[0].season.cropLabel) : null;
    if (!crop) return null;
    const s = summarizeIntention(crop, intention, items.map(i => fdCicScorable(i.record.data, i.season, toStatus(i.record.status))));
    if (s.ciGPerBu === null) return null;
    const pct = Math.abs(Math.round((s.vsNational ?? 0) * 100));
    return `CI ${Math.round(s.ciGPerBu).toLocaleString()} g/bu ${(s.vsNational ?? 0) <= 0 ? '▼' : '▲'}${pct}% vs national`;
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
    attestedNote: 'Incoming tickets are assigned this ID; delivery lots in the CI ledger point back to it.',
  },
};
