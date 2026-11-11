import { describe, it, expect } from 'vitest';
import { PlantingIntention } from '@models';
import { plantingChips, plantingQueryScope, isIrrigated, isDryland, isDoubleCrop, matchesPlantingTypes } from './planting-chips';

/** Commodities lookup as the component builds it: lower-cased code|name → crop category. */
const CATEGORIES = new Map<string, string>([
  ['yc', 'Corn'],
  ['yellow corn', 'Corn'],
  ['hrww', 'Wheat'],
]);

function intention(over: Partial<PlantingIntention>): PlantingIntention {
  return {
    id: 1, customerId: 10, customerName: 'Acme Farms', customerCode: 'C1',
    tradeUnit: 'TU1', plantingYear: 2026, crop: 'YC', acres: 100,
    createdAt: '2026-01-01T00:00:00Z', createdBy: 'tester',
    ...over,
  } as PlantingIntention;
}

describe('planting-chips', () => {
  it('shows only the most recent year when no year filter is applied', () => {
    const chips = plantingChips([
      intention({ id: 1, plantingYear: 2025, crop: 'YC', acres: 500 }),
      intention({ id: 2, plantingYear: 2026, crop: 'YC', acres: 300 }),
    ], {}, CATEGORIES);

    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ label: 'YC', acres: 300, year: 2026 });
  });

  it('honors an explicit year filter over the latest year', () => {
    const chips = plantingChips([
      intention({ id: 1, plantingYear: 2025, crop: 'YC', acres: 500 }),
      intention({ id: 2, plantingYear: 2026, crop: 'YC', acres: 300 }),
    ], { year: 2025 }, CATEGORIES);

    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ acres: 500, year: 2025 });
  });

  it('labels the chip with type + crop code and aggregates the same crop across trade units', () => {
    const chips = plantingChips([
      intention({ id: 1, tradeUnit: 'TU1', type: 'Irrigated', crop: 'YC', acres: 800 }),
      intention({ id: 2, tradeUnit: 'TU2', type: 'Irrigated', crop: 'YC', acres: 400 }),
      intention({ id: 3, type: 'Dryland', crop: 'HRWW', acres: 640 }),
    ], {}, CATEGORIES);

    expect(chips.map(c => `${c.label} ${c.acres}`)).toEqual(['Irrigated YC 1200', 'Dryland HRWW 640']);
  });

  it('keeps irrigated and dryland of the same crop as separate chips', () => {
    const chips = plantingChips([
      intention({ id: 1, type: 'Irrigated', crop: 'YC', acres: 800 }),
      intention({ id: 2, type: 'Dryland', crop: 'YC', acres: 200 }),
    ], {}, CATEGORIES);

    expect(chips.map(c => c.label)).toEqual(['Irrigated YC', 'Dryland YC']);
  });

  it('colors by the crop category resolved from the commodity code', () => {
    const chips = plantingChips([
      intention({ id: 1, crop: 'YC', category: 'White Corn' }),
      intention({ id: 2, crop: 'HRWW', acres: 50 }),
    ], {}, CATEGORIES);

    // Code → category wins over the (possibly tier-level) category on the row itself.
    expect(chips.find(c => c.label === 'YC')?.colorKey).toBe('Corn');
    expect(chips.find(c => c.label === 'HRWW')?.colorKey).toBe('Wheat');
  });

  it('falls back to the row category, then the raw crop, for unknown codes', () => {
    const chips = plantingChips([
      intention({ id: 1, crop: 'XYZ', category: 'Millet' }),
      intention({ id: 2, crop: 'ABC', acres: 10 }),
    ], {}, CATEGORIES);

    expect(chips.find(c => c.label === 'XYZ')?.colorKey).toBe('Millet');
    expect(chips.find(c => c.label === 'ABC')?.colorKey).toBe('ABC');
  });

  it('drops chips the active type toggles exclude', () => {
    const rows = [
      intention({ id: 1, type: 'Irrigated', crop: 'YC', acres: 800 }),
      intention({ id: 2, type: 'Dryland', crop: 'HRWW', acres: 640 }),
      intention({ id: 3, type: 'Double Crop', crop: 'HRWW', acres: 120 }),
    ];

    expect(plantingChips(rows, { irrigatedOnly: true }, CATEGORIES).map(c => c.label))
      .toEqual(['Irrigated YC']);
    // Multiple toggles OR together — a qualifying producer holds both kinds.
    expect(plantingChips(rows, { irrigatedOnly: true, drylandOnly: true }, CATEGORIES).map(c => c.label))
      .toEqual(['Irrigated YC', 'Dryland HRWW']);
  });

  it('sorts newest year first, then largest acreage', () => {
    const chips = plantingChips([
      intention({ id: 1, crop: 'HRWW', acres: 200 }),
      intention({ id: 2, crop: 'YC', acres: 900 }),
      intention({ id: 3, crop: 'SOR', acres: 450 }),
    ], {}, CATEGORIES);

    expect(chips.map(c => c.acres)).toEqual([900, 450, 200]);
  });

  it('skips rows with no crop or no acres, and handles an empty set', () => {
    expect(plantingChips([], {}, CATEGORIES)).toEqual([]);
    expect(plantingChips([
      intention({ id: 1, crop: '', acres: 100 }),
      intention({ id: 2, crop: 'YC', acres: 0 }),
    ], {}, CATEGORIES)).toEqual([]);
  });

  describe('plantingQueryScope', () => {
    it('reads the season a prompt asks about', () => {
      expect(plantingQueryScope('Producers with 2025 planting intentions').year).toBe(2025);
      expect(plantingQueryScope('Producers planting for 2026').year).toBe(2026);
      expect(plantingQueryScope('Planting intentions for 2026').year).toBe(2026);
      expect(plantingQueryScope('Producers who planted in 2024').year).toBe(2024);
    });

    it('does not read quantities as years', () => {
      expect(plantingQueryScope('Producers planting over 2000 acres').year).toBeNull();
      expect(plantingQueryScope('Producers with planting intentions').year).toBeNull();
      expect(plantingQueryScope('').year).toBeNull();
    });

    it('reads the irrigation type a prompt asks about', () => {
      expect(plantingQueryScope('Irrigated corn producers'))
        .toMatchObject({ irrigatedOnly: true, drylandOnly: false });
      expect(plantingQueryScope('Dry land wheat producers'))
        .toMatchObject({ irrigatedOnly: false, drylandOnly: true });
    });

    it('scopes chips to the prompt year instead of the latest year on file', () => {
      const rows = [
        intention({ id: 1, plantingYear: 2025, crop: 'YC', acres: 500 }),
        intention({ id: 2, plantingYear: 2026, crop: 'YC', acres: 300 }),
      ];
      const scope = plantingQueryScope('Producers with 2025 planting intentions');

      expect(plantingChips(rows, scope, CATEGORIES)[0])
        .toMatchObject({ acres: 500, year: 2025 });
    });
  });

  it('matches the free-text irrigation types the refine filters use', () => {
    expect(isIrrigated('Irrigated')).toBe(true);
    expect(isIrrigated('irrigation')).toBe(true);
    expect(isDryland('Dryland')).toBe(true);
    expect(isDryland('Dry Land')).toBe(true);
    expect(isDoubleCrop('Double Crop')).toBe(true);
    expect(isIrrigated(null)).toBe(false);
    expect(isDryland(undefined)).toBe(false);
    expect(matchesPlantingTypes(null, {})).toBe(true);
  });
});
