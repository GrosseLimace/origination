import { FieldSeason, ProducerField } from '@models';
import { SustainabilityProgramDef } from '../program-def';
import { GrainCraftIntakeComponent } from './graincraft-intake.component';

/** GrainCraft's data for one wheat field: the variety grown. */
export interface GrainCraftData {
  variety: string;
}

/**
 * GrainCraft: a wheat program that needs the variety grown on each field, on top of the field
 * details every program shares. No score and no producer-level enrollment, so it shows the variety on
 * the field's chip and has no enrollment card. Added to show how a second program sits next to 45Z.
 */
export const GRAINCRAFT_PROGRAM: SustainabilityProgramDef<GrainCraftData> = {
  key: 'graincraft',
  label: 'GrainCraft wheat',
  shortLabel: 'GrainCraft',
  description: 'Wheat variety for each field, for GrainCraft\'s program.',

  appliesTo: cropLabel => cropLabel.toLowerCase().includes('wheat'),
  blankData: () => ({ variety: '' }),
  // The same field often grows the same variety again, so carry it to the next wheat year.
  copyForward: (prior, priorCropLabel, cropLabel) =>
    priorCropLabel.toLowerCase().includes('wheat') && cropLabel.toLowerCase().includes('wheat') ? { variety: prior.variety } : null,

  missing: data => (data.variety.trim() ? [] : ['wheat variety']),
  preview: () => null,
  chipText: data => data.variety.trim() || null,

  finalizeMissing: data => (data.variety.trim() ? [] : ['wheat variety']),
  freeze: (data: GrainCraftData, season: FieldSeason, field: ProducerField) => ({
    inputs: {
      crop: season.cropLabel, cropYear: season.year, field: field.name, acres: season.acres,
      splitId: field.splitId, splitPercent: field.splitPercent,
      variety: data.variety.trim(),
    },
    outputs: {},
    calculatorVersion: 'GrainCraft field record v1',
  }),

  // A getter, so the program and its form can import each other without a load-order trap.
  get intake() { return GrainCraftIntakeComponent; },
};
