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

  it('should never copy the actual yield', () => {
    const lastYear = { ...corn2025, actualYield: 210 };
    expect(practicesToCopy(lastYear, 'Corn', 'Corn')).not.toHaveProperty('actualYield');
  });
});
