import { describe, it, expect } from 'vitest';
import { CopyablePractices, practicesToCopy } from './ci-copy-forward';

const soybeans2025: CopyablePractices = {
  expectedYield: 58, syntheticN: 0, niFraction: 0, tillage: 'NoTill', coverCrop: 'CoverCrop', manure: [],
};
const corn2025: CopyablePractices = {
  expectedYield: 205, syntheticN: 175, niFraction: 0.5, tillage: 'ReducedTill', coverCrop: 'None',
  manure: [{ type: 'Swine', form: 'Liquid', amount: 4, nContent: 30 }],
};

describe('practicesToCopy', () => {
  it('should copy every practice when the crop is the same', () => {
    expect(practicesToCopy(corn2025, 'Corn', 'Corn')).toEqual(corn2025);
  });

  it('should copy the manure rows, not share them', () => {
    const copied = practicesToCopy(corn2025, 'Corn', 'Corn');
    expect(copied.manure).not.toBe(corn2025.manure);
    expect(copied.manure![0]).not.toBe(corn2025.manure[0]);
  });

  it('should copy only tillage and cover crop when the crop changed', () => {
    // Soybeans' 0 lbs N must not land on this year's corn.
    expect(practicesToCopy(soybeans2025, 'Soybean', 'Corn')).toEqual({ tillage: 'NoTill', coverCrop: 'CoverCrop' });
  });

  it('should copy N applications, other fertilizer and energy for the same crop, but never evidence, ids or results', () => {
    const prior = {
      ...corn2025,
      nApplications: [{ product: 'UAN' as const, lbsN: 175, timing: 'Sidedress' as const, efficiency: 'None' as const }],
      noNApplied: false, phosphateLbs: 40, potashLbs: 60, limeTons: null,
      energy: { dieselGal: 4, gasolineGal: null, lpGal: 12, naturalGasTherms: null, electricityKwh: null },
      evidence: [{ id: 'e1', kind: 'YieldRecord' as const, reference: 'FSA-578', addedBy: 'you', addedAt: '2025-11-01' }],
      finalCiGPerBu: 4200, id: 'last-year', status: 'Final' as const, actualYield: 210,
    };
    const copied = practicesToCopy(prior, 'Corn', 'Corn');
    expect(copied.nApplications).toEqual(prior.nApplications);
    expect(copied.nApplications![0]).not.toBe(prior.nApplications[0]);
    expect(copied).toMatchObject({ phosphateLbs: 40, potashLbs: 60, energy: prior.energy });
    for (const key of ['evidence', 'finalCiGPerBu', 'id', 'status', 'actualYield']) {
      expect(copied).not.toHaveProperty(key);
    }
  });
});
