import { describe, it, expect } from 'vitest';
import { CommodityChipClassPipe } from './commodity-chip-class.pipe';
import { commodityChipClass } from '@shared/utils/commodity-color';

/** The palette rules live in commodity-color (see its spec); this pins that the pipe is that function. */
describe('CommodityChipClassPipe', () => {
  const pipe = new CommodityChipClassPipe();

  it('returns what commodityChipClass returns', () => {
    for (const crop of ['Corn', 'SOYBEANS', 'Organic Soybeans', 'Waxy Corn', 'Sunflowers', '', null, undefined]) {
      expect(pipe.transform(crop)).toBe(commodityChipClass(crop));
    }
    expect(pipe.transform('Corn')).toContain('bg-amber-100');
  });
});
