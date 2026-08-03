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

  it('does not throw on empty / null / undefined', () => {
    expect(() => commodityChipClass('')).not.toThrow();
    expect(() => commodityChipClass(null)).not.toThrow();
    expect(() => commodityChipClass(undefined)).not.toThrow();
  });
});
