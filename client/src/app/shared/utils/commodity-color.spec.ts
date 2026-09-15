import { describe, it, expect } from 'vitest';
import { commodityColor, commodityChipClass, commodityBarClass, commodityHex } from './commodity-color';

describe('commodity-color', () => {
  it('gives a fixed color per known crop, case-insensitive', () => {
    expect(commodityChipClass('Corn')).toContain('amber');
    expect(commodityChipClass('corn')).toBe(commodityChipClass('Corn')); // case-insensitive
    expect(commodityBarClass('Corn')).toBe('bg-amber-500');
    expect(commodityHex('Corn')).toBe('#f59e0b');
    expect(commodityBarClass('Soybeans')).toBe('bg-blue-500');
    expect(commodityBarClass('Wheat')).toBe('bg-green-500');
  });

  it('treats Milo and Sorghum as the same color', () => {
    expect(commodityColor('Milo')).toEqual(commodityColor('Sorghum'));
  });

  it('gives unknown crops a stable (same-every-time) fallback color', () => {
    const a = commodityChipClass('Triticale');
    const b = commodityChipClass('Triticale');
    expect(a).toBe(b);
    expect(a).toMatch(/^bg-/);
  });

  // The bid sheet groups by commodity CODE and resolves each one to its Commodities.category
  // before asking for a colour. These are the category spellings it relies on — if a key here is
  // renamed, every bid-sheet crop silently falls back to a hashed colour instead of its own.
  it('resolves the Commodities.category spellings the bid sheet passes in', () => {
    expect(commodityHex('CORN')).toBe('#f59e0b');
    expect(commodityHex('SOYBEANS')).toBe('#3b82f6');
    expect(commodityHex('SORGHUM')).toBe('#ef4444');
    expect(commodityHex('WHEAT')).toBe('#22c55e');
  });

  // Why that resolution matters: raw codes miss the palette entirely, and these three happen to
  // hash to the SAME fallback colour, which printed a whole bid sheet in one shade of blue.
  it('collides raw commodity codes onto one fallback colour', () => {
    expect(commodityHex('YC')).toBe(commodityHex('SOR'));
    expect(commodityHex('SOR')).toBe(commodityHex('YSB'));
    // ...whereas their categories are three distinct colours.
    expect(new Set([commodityHex('CORN'), commodityHex('SORGHUM'), commodityHex('SOYBEANS')]).size).toBe(3);
  });

  // The planting surfaces label organics by Commodity.plantingCategory ("Organic Soybeans"); the
  // colour must still be the base crop's, not a hashed fallback that could collide across organics.
  it('gives an organic variant its base crop colour', () => {
    expect(commodityColor('Organic Soybeans')).toEqual(commodityColor('Soybeans'));
    expect(commodityColor('ORGANIC CORN')).toEqual(commodityColor('Corn'));
    expect(commodityColor('organic wheat')).toEqual(commodityColor('Wheat'));
    // A base outside the fixed palette still lines up with its conventional counterpart's fallback.
    expect(commodityColor('Organic Barley')).toEqual(commodityColor('Barley'));
    expect(commodityChipClass('Organic Triticale')).toBe(commodityChipClass('Triticale'));
  });

  // The IP grades (Commodity.plantingCategory for YWC / HEC / DNGS / DOSB) end in their base crop.
  it('gives a specialty grade its base crop colour by its last word', () => {
    expect(commodityColor('Waxy Corn')).toEqual(commodityColor('Corn'));
    expect(commodityColor('Hard Endosperm Corn')).toEqual(commodityColor('Corn'));
    expect(commodityColor('Dehulled Non-GMO Soybeans')).toEqual(commodityColor('Soybeans'));
    expect(commodityColor('Dehulled Organic Soybeans')).toEqual(commodityColor('Soybeans'));
    // Only a trailing crop word counts — a product that merely mentions corn keeps its own colour.
    expect(commodityColor('Corn Screenings')).not.toEqual(commodityColor('Corn'));
  });

  it('does not throw on empty / null / undefined', () => {
    expect(() => commodityChipClass('')).not.toThrow();
    expect(() => commodityChipClass(null)).not.toThrow();
    expect(() => commodityChipClass(undefined)).not.toThrow();
  });
});
