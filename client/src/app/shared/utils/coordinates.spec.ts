import { describe, it, expect } from 'vitest';

import { binSiteHasCoordinates, formatBinSiteCapacity, formatBinSiteCapacityInput, formatBinSiteDetails, formatBinSiteLabel, formatBinSiteTitle, formatCoordinatePair, formatCoordinatePairFull, parseBinSiteCapacity, parseCoordinatePair } from './coordinates';

function ok(text: string) {
  const result = parseCoordinatePair(text);
  if (!result.ok) throw new Error(`expected "${text}" to parse, got: ${result.error}`);
  return result;
}

function error(text: string): string {
  const result = parseCoordinatePair(text);
  if (result.ok) throw new Error(`expected "${text}" to be rejected`);
  return result.error;
}

describe('parseCoordinatePair — accepted input', () => {
  it('parses the card example exactly', () => {
    expect(ok('39.115876, -95.143955')).toEqual({ ok: true, lat: 39.115876, lng: -95.143955 });
  });

  it('keeps a full-precision Google Maps paste exactly — the user never rounds by hand', () => {
    expect(ok('41.39034548435109, -95.00754031349179')).toEqual({ ok: true, lat: 41.39034548435109, lng: -95.00754031349179 });
  });

  it('accepts fewer than six places as-is', () => {
    expect(ok('40.5, -96')).toMatchObject({ lat: 40.5, lng: -96 });
  });

  it.each([
    ['no space after the comma', '39.115876,-95.143955'],
    ['a space instead of a comma', '39.115876 -95.143955'],
    ['surrounding whitespace', '   39.115876 ,  -95.143955  '],
    ['an explicit plus on latitude', '+39.115876, -95.143955'],
  ])('accepts %s', (_label, text) => {
    expect(ok(text)).toMatchObject({ lat: 39.115876, lng: -95.143955 });
  });

  it.each([
    ['the southern latitude edge', '7, -80'],
    ['the northern latitude edge', '84, -80'],
    ['the western longitude edge', '52, -180'],
    ['the eastern longitude edge', '47.5, -52'],
  ])('accepts %s', (_label, text) => {
    expect(parseCoordinatePair(text).ok).toBe(true);
  });

  it('judges the bounds on the value as entered, since nothing is rounded', () => {
    expect(parseCoordinatePair('84.0000004, -80').ok).toBe(false);
  });
});

describe('parseCoordinatePair — free-hand entry', () => {
  it.each([
    ['spaces only', '41.39 -95.01'],
    ['a semicolon', '41.39; -95.01'],
    ['degree signs', '41.39°, -95.01°'],
    ['compass letters after', '41.39° N, 95.01° W'],
    ['compass letters with no comma', '41.39N 95.01W'],
    ['compass letters before', 'N41.39 W95.01'],
    ['spaced compass letters before', 'N 41.39, W 95.01'],
    ['a lone N spaced off the first number', '41.39 N -95.01'],
    ['a W plus a minus (still west, not a double negative)', '41.39, -95.01 W'],
    ['longitude first when letters say so', '95.01 W, 41.39 N'],
    ['Lat:/Long: labels', 'Lat: 41.39, Long: -95.01'],
    ['a typographic minus from a web page', '41.39, −95.01'],
    ['lower-case letters', '41.39 n, 95.01 w'],
  ])('reads %s', (_label, text) => {
    expect(ok(text)).toEqual({ ok: true, lat: 41.39, lng: -95.01 });
  });

  it.each([
    ['as Google Maps\' side panel shows it', `41°23'25.2"N 95°00'27.1"W`],
    ['with typographic prime marks', '41°23′25.2″N 95°00′27.1″W'],
    ['with no marks, split by a comma', '41 23 25.2 N, 95 0 27.1 W'],
  ])('converts degrees-minutes-seconds %s to decimal degrees', (_label, text) => {
    const result = ok(text);
    expect(result.lat).toBeCloseTo(41.390333333, 8);
    expect(result.lng).toBeCloseTo(-95.007527778, 8);
  });
});

describe('parseCoordinatePair — rejected input', () => {
  it.each([
    ['empty', ''],
    ['a single number', '39.115876'],
    ['three numbers', '39.1, -95.1, 12'],
    ['words', 'Anderson Site'],
    ['a dangling comma', '41.39,'],
  ])('asks for latitude then longitude when given %s', (_label, text) => {
    expect(error(text)).toContain('latitude, then longitude');
  });

  it('spots a dropped minus sign on longitude', () => {
    expect(error('39.115876, 95.143955')).toContain('minus sign');
  });

  it('spots swapped latitude and longitude', () => {
    expect(error('-95.143955, 39.115876')).toContain('swapped');
  });

  it('rejects contradictory signs and letters', () => {
    expect(error('-41.39 N, 95.01 W')).toContain('contradicts');
  });

  it('rejects two latitudes', () => {
    expect(error('41.39 N, 95.01 N')).toContain('N or S for latitude');
  });

  it('rejects minutes or seconds of 60 or more', () => {
    expect(error(`41°75'0"N 95°0'0"W`)).toContain('under 60');
  });

  it.each([
    ['south of Panama', '6.999999, -80'],
    ['past the Canadian Arctic', '84.000001, -80'],
    ['in the southern hemisphere', '-39.115876, -95.143955'],
  ])('rejects a latitude %s', (_label, text) => {
    expect(error(text)).toContain('latitude must be between 7 and 84');
  });

  it.each([
    ['east of Newfoundland', '47.5, -51.999999'],
    ['past -180', '52, -180.000001'],
  ])('rejects a longitude %s', (_label, text) => {
    expect(error(text)).toContain('longitude must be between -180 and -52');
  });

  it('does not suggest adding a minus when that would still miss North America', () => {
    // -20 would be the Atlantic, so "add a minus" would be bad advice.
    const message = error('39.1, 20');
    expect(message).toContain('east of Greenwich');
    expect(message).not.toContain('minus sign');
  });
});

// The point of the North American rule: a bin site can't land in another country by mistake.
describe('parseCoordinatePair — places outside North America', () => {
  it.each([
    ['Beijing, China', '39.9042, 116.4074'],
    ['Beijing, China, with compass letters', '39.9042 N, 116.4074 E'],
    ['Shanghai, China', '31.2304, 121.4737'],
    ['Tokyo, Japan', '35.6762, 139.6503'],
    ['Paris, France', '48.8566, 2.3522'],
    ['London, UK', '51.5074, -0.1278'],
    ['Sydney, Australia', '-33.8688, 151.2093'],
    ['São Paulo, Brazil', '-23.5505, -46.6333'],
    ['Lagos, Nigeria', '6.5244, 3.3792'],
  ])('rejects %s', (_label, text) => {
    expect(error(text)).toContain('outside North America');
  });

  it.each([
    ['Kansas', '39.115876, -95.143955'],
    ['Saskatchewan', '52.1332, -106.6700'],
    ['Jalisco, Mexico', '20.6597, -103.3496'],
    ['Fairbanks, Alaska', '64.8378, -147.7164'],
  ])('accepts %s', (_label, text) => {
    expect(parseCoordinatePair(text).ok).toBe(true);
  });
});

describe('formatting', () => {
  it('always shows six places', () => {
    expect(formatCoordinatePair(40.5, -96)).toBe('40.500000, -96.000000');
  });

  it('shortens a long paste to six places for display only', () => {
    expect(formatCoordinatePair(41.39034548435109, -95.00754031349179)).toBe('41.390345, -95.007540');
  });

  it('gives the full stored value back for editing, unshortened', () => {
    expect(formatCoordinatePairFull(41.39034548435109, -95.00754031349179)).toBe('41.39034548435109, -95.00754031349179');
  });

  it('puts the full value in the hover title', () => {
    expect(formatBinSiteTitle({ name: 'North Bins', latitude: 41.39034548435109, longitude: -95.00754031349179 }))
      .toBe('North Bins: 41.39034548435109, -95.00754031349179 — open in Google Maps');
  });

  it('labels a named site with its name', () => {
    expect(formatBinSiteLabel({ name: 'Anderson Site', latitude: 39.115876, longitude: -95.143955 }))
      .toBe('Anderson Site: 39.115876, -95.143955');
  });

  it('shows only the coordinates for an unnamed site', () => {
    expect(formatBinSiteLabel({ name: null, latitude: 39.115876, longitude: -95.143955 }))
      .toBe('39.115876, -95.143955');
    expect(formatBinSiteLabel({ name: '   ', latitude: 39.115876, longitude: -95.143955 }))
      .toBe('39.115876, -95.143955');
  });
});

describe('bin site capacity', () => {
  it('reads digits only, as whole bushels', () => {
    expect(parseBinSiteCapacity('50,000')).toBe(50000);
    expect(parseBinSiteCapacity('50000 bu')).toBe(50000);
    expect(parseBinSiteCapacity('')).toBeNull();
    expect(parseBinSiteCapacity('bu')).toBeNull();
  });

  it('groups the input as typed', () => {
    expect(formatBinSiteCapacityInput('1234567')).toBe('1,234,567');
    expect(formatBinSiteCapacityInput('')).toBe('');
  });

  it('shows "N bu" for display, or nothing without a capacity', () => {
    expect(formatBinSiteCapacity(50000)).toBe('50,000 bu');
    expect(formatBinSiteCapacity(null)).toBe('');
    expect(formatBinSiteCapacity(undefined)).toBe('');
  });

  it('puts the capacity in the hover title', () => {
    expect(formatBinSiteTitle({ name: 'North', latitude: 41.39, longitude: -95.01, capacity: 50000 }))
      .toBe('North: 41.39, -95.01 · 50,000 bu capacity — open in Google Maps');
  });
});

describe('formatBinSiteDetails', () => {
  it('lists commodity and bushels in order, only what is filled in', () => {
    expect(formatBinSiteDetails({ latitude: 1, longitude: -1, commodityCode: 'YC', capacity: 50000, marketed: 20000, unmarketed: 30000 }))
      .toBe('YC · 50,000 bu capacity · 20,000 marketed · 30,000 unmarketed');
    expect(formatBinSiteDetails({ latitude: 1, longitude: -1, marketed: 0 })).toBe('0 marketed');
    expect(formatBinSiteDetails({ latitude: 1, longitude: -1 })).toBe('');
  });
});

// Only the name is required (2026-10-09), so a site may have no coordinates at all.
describe('bin site without coordinates', () => {
  const site = { name: 'Home place', capacity: 20000 };

  it('is recognised as having none', () => {
    expect(binSiteHasCoordinates(site)).toBe(false);
    expect(binSiteHasCoordinates({ latitude: 41.39, longitude: -95.01 })).toBe(true);
  });

  it('labels with the name alone', () => {
    expect(formatBinSiteLabel(site)).toBe('Home place');
  });

  it('has hover text without "open in Google Maps"', () => {
    expect(formatBinSiteTitle(site)).toBe('Home place: 20,000 bu capacity');
  });
});
