import { describe, it, expect } from 'vitest';

import { formatBinSiteLabel, formatCoordinatePair, parseCoordinatePair } from './coordinates';

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

  it('rounds a full-precision Google Maps paste to six places', () => {
    expect(ok('39.11587612345678, -95.14395512345678')).toMatchObject({ lat: 39.115876, lng: -95.143955 });
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

  it('judges the bounds after rounding, as the server stores it', () => {
    // 84.0000004 rounds to 84.000000 — inside the box.
    expect(ok('84.0000004, -80')).toMatchObject({ lat: 84 });
  });
});

describe('parseCoordinatePair — rejected input', () => {
  it.each([
    ['empty', ''],
    ['a single number', '39.115876'],
    ['three numbers', '39.1, -95.1, 12'],
    ['words', 'Anderson Site'],
    ['degree notation', '39.115876° N, 95.143955° W'],
  ])('asks for two numbers when given %s', (_label, text) => {
    expect(error(text)).toContain('latitude, then longitude');
  });

  it('spots a dropped minus sign on longitude', () => {
    expect(error('39.115876, 95.143955')).toContain('minus sign');
  });

  it('spots swapped latitude and longitude', () => {
    expect(error('-95.143955, 39.115876')).toContain('swapped');
  });

  it.each([
    ['south of Panama', '6.999999, -80'],
    ['past the Canadian Arctic', '84.000001, -80'],
    ['in the southern hemisphere', '-39.115876, -95.143955'],
  ])('rejects a latitude %s', (_label, text) => {
    expect(error(text)).toContain('Latitude must be between 7 and 84');
  });

  it.each([
    ['east of Newfoundland', '47.5, -51.999999'],
    ['past -180', '52, -180.000001'],
  ])('rejects a longitude %s', (_label, text) => {
    expect(error(text)).toContain('Longitude must be between -180 and -52');
  });

  it('treats a positive longitude with no North American mirror as out of range, not a dropped minus', () => {
    // -20 would be the Atlantic, so "add a minus" would be bad advice.
    expect(error('39.1, 20')).toContain('Longitude must be between');
  });
});

describe('formatting', () => {
  it('always shows six places', () => {
    expect(formatCoordinatePair(40.5, -96)).toBe('40.500000, -96.000000');
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
