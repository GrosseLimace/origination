import { describe, expect, it } from 'vitest';

import { formatCoordinates, parseCoordinates } from './coordinates';

describe('parseCoordinates', () => {
  it('reads a Google Maps copy and plain decimals', () => {
    expect(parseCoordinates('41.20000, -96.10000')).toEqual({ latitude: 41.2, longitude: -96.1 });
    expect(parseCoordinates('41.2 -96.1')).toEqual({ latitude: 41.2, longitude: -96.1 });
  });

  it('uses N/S/E/W letters for the sign', () => {
    expect(parseCoordinates('41.2 N, 96.1 W')).toEqual({ latitude: 41.2, longitude: -96.1 });
    expect(parseCoordinates('41.2°N, 96.1°W')).toEqual({ latitude: 41.2, longitude: -96.1 });
  });

  it('is null when blank and invalid when unreadable or outside North America', () => {
    expect(parseCoordinates('  ')).toBeNull();
    expect(parseCoordinates('somewhere')).toBe('invalid');
    expect(parseCoordinates('41.2')).toBe('invalid');
    expect(parseCoordinates('41.2, 96.1')).toBe('invalid'); // east longitude: not North America
    expect(parseCoordinates('-41.2, -96.1')).toBe('invalid');
  });

  it('formats a pair for editing', () => {
    expect(formatCoordinates(41.2, -96.1)).toBe('41.2, -96.1');
    expect(formatCoordinates(41.2, null)).toBe('');
  });
});
