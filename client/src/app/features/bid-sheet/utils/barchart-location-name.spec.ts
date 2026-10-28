import { describe, expect, it } from 'vitest';
import { BarchartCatalogLocation } from '@models';
import { barchartDisplayName, barchartSaveName, barchartSiteLabel, isScoularListing } from './barchart-location-name';

function location(overrides: Partial<BarchartCatalogLocation> = {}): BarchartCatalogLocation {
  return {
    locationKey: '82259',
    elevator: 'Grain Processing Corporation',
    locationName: 'GPC-MUSCATINE',
    city: 'Muscatine',
    state: 'IA',
    instrumentCount: 8,
    commodityCount: 2,
    placements: [],
    ...overrides,
  };
}

describe('barchartSiteLabel', () => {
  // The measured majority case (60% of the live catalog): the vendor's "site name" is nothing but
  // the town again, sometimes with the state appended. Showing it would just repeat the subtitle line.
  it('drops a site name that is only the city', () => {
    expect(barchartSiteLabel(location({ locationName: 'Muscatine', city: 'Muscatine' }))).toBe('');
  });

  it('drops a site name that is the city plus state, in any punctuation/casing', () => {
    expect(barchartSiteLabel(location({ locationName: 'Salina, KS', city: 'Salina', state: 'KS' }))).toBe('');
    expect(barchartSiteLabel(location({ locationName: 'SALINA KS', city: 'Salina', state: 'KS' }))).toBe('');
  });

  it('keeps a site name that actually distinguishes the location', () => {
    expect(barchartSiteLabel(location({ locationName: 'GPC-MUSCATINE', city: 'Muscatine' }))).toBe('GPC-MUSCATINE');
  });

  it('is empty when the catalog has no site name at all', () => {
    expect(barchartSiteLabel(location({ locationName: undefined }))).toBe('');
  });
});

describe('barchartDisplayName', () => {
  it('joins company and a real site name', () => {
    expect(barchartDisplayName(location())).toBe('Grain Processing Corporation - GPC-MUSCATINE');
  });

  // Display omits a site that only repeats the city -- the subtitle line already shows it, and the
  // headline reads better without saying Muscatine twice.
  it('omits the site when it only repeats the city', () => {
    expect(barchartDisplayName(location({ locationName: 'Muscatine' }))).toBe('Grain Processing Corporation');
  });

  it('falls back to the location key when there is no company or usable site', () => {
    expect(barchartDisplayName(location({ elevator: undefined, locationName: undefined }))).toBe('BarChart 82259');
  });
});

describe('barchartSaveName', () => {
  // The bid sheet has no second line, and names must stay distinguishable across a company's several
  // town-named sites -- so unlike the display name, the save name keeps the city even when the
  // vendor's own site name was dropped as a duplicate of it.
  it('keeps the city as a qualifier even when the site name duplicated it', () => {
    expect(barchartSaveName(location({ locationName: 'Muscatine' }))).toBe('Grain Processing Corporation - Muscatine');
  });

  it('joins company and a real site name, same as the display name', () => {
    expect(barchartSaveName(location())).toBe('Grain Processing Corporation - GPC-MUSCATINE');
  });

  it('falls back to the location key when there is nothing else to name it', () => {
    expect(barchartSaveName(location({ elevator: undefined, locationName: undefined, city: undefined }))).toBe('BarChart 82259');
  });
});

describe('isScoularListing', () => {
  // Six naming variants exist in the live catalog, so a substring match on the PUBLISHER is the rule.
  it('matches the publishing company however it is spelled', () => {
    for (const elevator of ['The Scoular Company', 'Scoular Co - West', 'SCOULAR COMPANY - NEBRASKA', 'scoular']) {
      expect(isScoularListing(location({ elevator }))).toBe(true);
    }
  });

  it('does not match somebody else', () => {
    expect(isScoularListing(location({ elevator: 'Kanza Cooperative' }))).toBe(false);
    expect(isScoularListing(location({ elevator: undefined }))).toBe(false);
  });

  // Checks the publisher, NOT the site name -- a vendor site name is sometimes another company's name,
  // so reading it would mark somebody else's elevator as ours.
  it('ignores the site name', () => {
    expect(isScoularListing(location({ elevator: 'Kanza Cooperative', locationName: 'SCOULAR-SALINA' }))).toBe(false);
  });
});
