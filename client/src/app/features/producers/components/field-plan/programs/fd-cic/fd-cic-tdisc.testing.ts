import { TDiscOptions } from '@models';
import type { TDiscApiService } from '../../../../data-access/tdisc-api.service';

/**
 * A slice of USDA T-DISC v1.1.1 for tests: the implements the specs use, with the pack's own mixing efficiency
 * and depth (api/.../Content/TDisc/v1.1.1/implements.json). The window lists are trimmed to these implements.
 */
const IMPLEMENTS: [string, number, number][] = [
  ['AERATOR', 0.05, 20],
  ['CULTIVATOR, FIELD', 0.39, 10],
  ['CULTIVATOR, ROTARY HOE', 0.75, 3],
  ['HARROW, COILED TINES', 0.2, 3],
  ['HARROW, DISK, CHISEL (MULCH TILLER)', 0.4, 16],
  ['HARROW, DISK, TANDEM, LIGHTDUTY', 0.8, 8],
  ['HARROW, SPIKE TOOTH OR SPRING TOOTH', 0.32, 3],
  ['HARVEST, GRAIN', 0, 0],
  ['NUTRIENT MGMT: FERT APPL, SHANK', 0.2, 18],
  ['PLANTER, NO-TILL', 0.05, 6],
  ['PLANTER, REGULAR', 0.05, 4],
  ['PLOW, CHISEL', 0.6, 25],
  ['PLOW, MOLDBOARD', 0.9, 15],
  ['PLOW, SWEEP', 0.15, 20],
  ['RESIDUE MGMT: STALK PULLER CHOPPER', 0.2, 10],
  ['SPRAYER/AERIAL/BROADCAST APPLICATION', 0, 0],
];

const tillage = IMPLEMENTS.map(([name]) => name).filter(n => !['HARVEST, GRAIN', 'RESIDUE MGMT: STALK PULLER CHOPPER'].includes(n));

export const TDISC_TEST_OPTIONS: TDiscOptions = {
  version: '1.1.1',
  label: 'USDA T-DISC v1.1.1',
  maxPasses: 20,
  indexDepthCm: 30,
  designations: [{ max: 1, designation: 'CT' }, { max: 0.252, designation: 'RT' }, { max: 0.075, designation: 'NT' }],
  windows: [
    { key: 'Field_Preparation', label: 'Field preparation', implements: tillage },
    { key: 'Before_Planting', label: 'Before planting', implements: tillage },
    { key: 'Planting', label: 'Planting', implements: tillage },
    { key: 'After_Planting', label: 'After planting', implements: ['SPRAYER/AERIAL/BROADCAST APPLICATION', 'HARROW, COILED TINES'] },
    { key: 'Harvest', label: 'Harvest', implements: ['HARVEST, GRAIN', 'RESIDUE MGMT: STALK PULLER CHOPPER'] },
  ],
  implements: IMPLEMENTS.map(([name, mixingEfficiency, depthCm]) => ({ name, mixingEfficiency, depthCm })),
  operations: [
    { name: 'Chisel, straight point, coil tine harrow', implements: ['HARROW, DISK, CHISEL (MULCH TILLER)', 'HARROW, COILED TINES'] },
    { name: 'Combine', implements: ['HARVEST, GRAIN'] },
  ],
};

/** A TDiscApiService stand-in with the options above already loaded. */
export function fakeTDiscApi(): Pick<TDiscApiService, 'options' | 'load' | 'error'> {
  return { options: () => TDISC_TEST_OPTIONS, load: async () => TDISC_TEST_OPTIONS, error: (() => '') as TDiscApiService['error'] };
}
