import { describe, it, expect } from 'vitest';
import { Commodity } from '@models';
import { commodityPlantingCategory, plantingCategory } from './planting-category';

const commodity = (code: string, category?: string, plantingCategory?: string | null): Commodity =>
  ({ id: 0, code, name: code, category, plantingCategory, isActive: true });

// Rows as the Dev Commodities table actually holds them (title-case Category).
const YSB = commodity('YSB', 'Soybeans');
const YSBO = commodity('YSBO', 'Soybeans', 'Organic Soybeans');
const NYSB_NO_CATEGORY = commodity('NYSB', undefined);

describe('commodityPlantingCategory', () => {
  it('prefers the planting override, then the broad category', () => {
    expect(commodityPlantingCategory(YSBO)).toBe('Organic Soybeans');
    expect(commodityPlantingCategory(YSB)).toBe('Soybeans');
  });

  it('is undefined when the commodity is missing or has neither', () => {
    expect(commodityPlantingCategory(undefined)).toBeUndefined();
    expect(commodityPlantingCategory(null)).toBeUndefined();
    expect(commodityPlantingCategory(NYSB_NO_CATEGORY)).toBeUndefined();
    expect(commodityPlantingCategory(commodity('X', '  ', '  '))).toBeUndefined();
  });
});

describe('plantingCategory', () => {
  it('labels an organic row by the commodity override when nothing is stored on the row', () => {
    expect(plantingCategory({ crop: 'YSBO' }, YSBO)).toBe('Organic Soybeans');
    expect(plantingCategory({ crop: 'YSBO', category: '' }, YSBO)).toBe('Organic Soybeans');
  });

  // The add/edit form used to auto-fill the broad category, so every organic row saved before the
  // override existed carries "Soybeans". Those must resolve to the organic label WITHOUT being
  // edited — otherwise the fix only applies to rows entered from now on.
  it('treats a stored category equal to the broad category as the auto-filled default', () => {
    expect(plantingCategory({ crop: 'YSBO', category: 'Soybeans' }, YSBO)).toBe('Organic Soybeans');
    expect(plantingCategory({ crop: 'YSBO', category: 'SOYBEANS' }, YSBO)).toBe('Organic Soybeans'); // PROD casing
  });

  it('keeps an explicit per-row override (a tier picked from the dropdown)', () => {
    expect(plantingCategory({ crop: 'YSB', category: 'Non-GMO Soybeans' }, YSB)).toBe('Non-GMO Soybeans');
    expect(plantingCategory({ crop: 'YSBO', category: 'Organic Dehulled Soybeans' }, YSBO)).toBe('Organic Dehulled Soybeans');
    // Storing the organic label itself is just the new default and resolves the same.
    expect(plantingCategory({ crop: 'YSBO', category: 'Organic Soybeans' }, YSBO)).toBe('Organic Soybeans');
  });

  it('leaves conventional crops exactly as before', () => {
    expect(plantingCategory({ crop: 'YSB' }, YSB)).toBe('Soybeans');
    expect(plantingCategory({ crop: 'YSB', category: 'Soybeans' }, YSB)).toBe('Soybeans');
  });

  it('falls back to the stored category, then the crop code, for a commodity not in the lookup', () => {
    expect(plantingCategory({ crop: 'BLY', category: 'Barley' }, undefined)).toBe('Barley');
    expect(plantingCategory({ crop: 'BLY' }, undefined)).toBe('BLY');
    expect(plantingCategory({ crop: 'NYSB' }, NYSB_NO_CATEGORY)).toBe('NYSB');
    expect(plantingCategory({ crop: 'NYSB', category: 'Soybeans' }, NYSB_NO_CATEGORY)).toBe('Soybeans');
  });
});
