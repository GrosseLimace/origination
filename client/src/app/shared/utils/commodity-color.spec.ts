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

  it('does not throw on empty / null / undefined', () => {
    expect(() => commodityChipClass('')).not.toThrow();
    expect(() => commodityChipClass(null)).not.toThrow();
    expect(() => commodityChipClass(undefined)).not.toThrow();
  });
});
