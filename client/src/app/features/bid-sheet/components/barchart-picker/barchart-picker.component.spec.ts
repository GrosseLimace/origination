import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';

import { BarchartPickerComponent } from './barchart-picker.component';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { BarchartCatalogLocation, BarchartCoverage } from '@models';

const coverage: BarchartCoverage = {
  locationCount: 2894,
  lastRefreshedUtc: '2026-08-18T09:06:15Z',
  states: [
    { state: 'IA', locationCount: 637 },
    { state: 'IL', locationCount: 469 },
  ],
};

function location(overrides: Partial<BarchartCatalogLocation> = {}): BarchartCatalogLocation {
  return {
    locationKey: '82259',
    elevator: 'Grain Processing Corporation',
    locationName: 'GPC-MUSCATINE',
    city: 'Muscatine',
    state: 'IA',
    latitude: 41.39,
    longitude: -91.04,
    instrumentCount: 8,
    commodityCount: 2,
    placements: [],
    ...overrides,
  };
}

describe('BarchartPickerComponent', () => {
  let component: BarchartPickerComponent;
  let fixture: ComponentFixture<BarchartPickerComponent>;

  const apiMock = {
    getBarchartCoverage: vi.fn(),
    searchBarchartLocations: vi.fn(),
  };
  const toastMock = { error: vi.fn(), success: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    apiMock.getBarchartCoverage.mockReturnValue(of(coverage));
    apiMock.searchBarchartLocations.mockReturnValue(of([location()]));

    await TestBed.configureTestingModule({
      imports: [BarchartPickerComponent],
      providers: [
        { provide: ApiService, useValue: apiMock },
        { provide: ToastService, useValue: toastMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BarchartPickerComponent);
    component = fixture.componentInstance;
  });

  it('states the catalog coverage so an empty result is explainable', () => {
    fixture.detectChanges();
    expect(component.coverageSummary()).toContain('2,894 locations across 2 states');
    expect(component.topStatesLabel()).toBe(' (IA, IL)');
  });

  it('searches near the map view when nothing has been typed', () => {
    fixture.componentRef.setInput('searchArea', { latitude: 41.4, longitude: -91.0, radiusMiles: 60 });
    fixture.detectChanges();

    expect(apiMock.searchBarchartLocations).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 41.4, longitude: -91.0, radiusMiles: 60 }));
  });

  // A typed search is catalog-wide. Narrowing it by wherever the map happens to sit would hide the
  // match the user asked for and look like the location isn't in the feed.
  it('drops the map centre once the user types a search', () => {
    fixture.componentRef.setInput('searchArea', { latitude: 41.4, longitude: -91.0, radiusMiles: 60 });
    fixture.detectChanges();
    apiMock.searchBarchartLocations.mockClear();

    component.searchText.set('muscatine');
    component.onStateChange('');

    expect(apiMock.searchBarchartLocations).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'muscatine', latitude: undefined, longitude: undefined }));
  });

  it('emits results so the map can pin them', () => {
    const emitted: BarchartCatalogLocation[][] = [];
    component.resultsChange.subscribe(r => emitted.push(r));
    fixture.componentRef.setInput('searchArea', { latitude: 41.4, longitude: -91.0, radiusMiles: 60 });
    fixture.detectChanges();

    expect(emitted.at(-1)?.[0].locationKey).toBe('82259');
  });

  it('falls back through site, then the key, when the company is missing', () => {
    expect(component.defaultName(location({ elevator: undefined }))).toBe('GPC-MUSCATINE');
    // no trailing separator when only one half exists
    expect(component.defaultName(location({ elevator: undefined, locationName: undefined, city: undefined })))
      .toBe('BarChart 82259');
  });

  // 1,367 of the 3,446 listings have a site name that genuinely identifies one of a company's sites.
  it('headlines company and site, with the town on the second line', () => {
    const loc = location({ elevator: 'Farmers Cooperative Dorchester', locationName: 'HERKIMER', city: 'Marysville', state: 'KS' });

    expect(component.primaryName(loc)).toBe('Farmers Cooperative Dorchester - HERKIMER');
    expect(component.locationSubtitle(loc)).toBe('Marysville, KS');
  });

  // 1,775 of the 3,446 listings set the site name to the city. Keeping it would print the town twice,
  // once in the label and again on the line below it.
  it('drops the site from the label when the vendor just repeated the town', () => {
    const loc = location({ locationName: 'NORTON', city: 'Norton', state: 'KS', elevator: 'Ag Valley Co-op' });

    expect(component.primaryName(loc)).toBe('Ag Valley Co-op');
    expect(component.locationSubtitle(loc)).toBe('Norton, KS');
  });

  // Another 304 set it to the town AND state — "Salina, KS", "FARNSWORTH TX". Comparing raw strings
  // missed these, so the label read "Scoular Company - Kansas - Salina, KS" over "Salina, KS".
  it.each(['Salina, KS', 'SALINA KS', 'salina-ks'])(
    'drops the site when the vendor repeated the town and state as "%s"', (site) => {
      const loc = location({ locationName: site, city: 'Salina', state: 'KS', elevator: 'Scoular Company - Kansas' });

      expect(component.siteLabel(loc)).toBe('');
      expect(component.primaryName(loc)).toBe('Scoular Company - Kansas');
      expect(component.locationSubtitle(loc)).toBe('Salina, KS');
    });

  // The bid sheet row has no second line to carry the town, and names are unique per trade unit — so
  // the SAVED name keeps the town even where the label drops it.
  it('keeps the town in the saved name even when the label drops it', () => {
    const loc = location({ locationName: 'Salina, KS', city: 'Salina', state: 'KS', elevator: 'Scoular Company - Kansas' });

    expect(component.primaryName(loc)).toBe('Scoular Company - Kansas');
    expect(component.defaultName(loc)).toBe('Scoular Company - Kansas - Salina');
  });

  // Some listings carry another company's name as the site name — a CHS listing whose site name is
  // "GPC Muscatine". Leading with the company keeps the bid attributed to whoever is actually buying.
  it('leads with the company even when the site name names a different one', () => {
    const loc = location({ elevator: 'CHS - Illinois', locationName: 'GPC Muscatine', city: 'Muscatine', state: 'IA' });

    expect(component.primaryName(loc)).toBe('CHS - Illinois - GPC Muscatine');
    expect(component.locationSubtitle(loc)).toBe('Muscatine, IA');
  });

  // Where the site name is genuinely distinct, label and saved name agree exactly.
  it('saves exactly the label shown when the site name is distinct', () => {
    const loc = location();
    expect(component.defaultName(loc)).toBe(component.primaryName(loc));
    expect(component.defaultName(loc)).toBe('Grain Processing Corporation - GPC-MUSCATINE');
  });

  it('surfaces a search failure without leaving stale pins on the map', () => {
    apiMock.searchBarchartLocations.mockReturnValue(throwError(() => new Error('boom')));
    const emitted: BarchartCatalogLocation[][] = [];
    component.resultsChange.subscribe(r => emitted.push(r));
    fixture.componentRef.setInput('searchArea', { latitude: 41.4, longitude: -91.0, radiusMiles: 60 });
    fixture.detectChanges();

    expect(component.results()).toEqual([]);
    expect(emitted.at(-1)).toEqual([]);
    expect(toastMock.error).toHaveBeenCalled();
  });

  // Coverage is a nicety; losing it shouldn't interrupt the search the user came to do.
  it('still works when coverage cannot be loaded', () => {
    apiMock.getBarchartCoverage.mockReturnValue(throwError(() => new Error('nope')));
    const f = TestBed.createComponent(BarchartPickerComponent);
    f.detectChanges();

    expect(f.componentInstance.coverage()).toBeNull();
    expect(f.componentInstance.coverageSummary()).toBe('');
  });

  // -------------------------------------------------------------------------
  // Trade-unit selector. Originators can hold a lot of desks, and the picker is opened from the map
  // with no trade unit chosen, so the list has to be searchable rather than just long.

  // -------------------------------------------------------------------------
  // Bulk add. The confirm step it replaced named and classified one elevator at a time, which is a
  // round trip per location when an originator is standing up a whole area. Names and the Scoular
  // flag are now proposed here and corrected on Edit Bids, so both have to be proposed correctly.

  it('marks a listing published by Scoular as one of ours', () => {
    expect(component.isScoularListing(location({ elevator: 'Scoular Company - Kansas' }))).toBe(true);
    // The site name alone is unreliable -- some Scoular sites are just a town.
    expect(component.isScoularListing(location({ elevator: 'The Scoular Company', locationName: 'Corley, IA' }))).toBe(true);
  });

  it('leaves a competitor listing unmarked', () => {
    expect(component.isScoularListing(location())).toBe(false);
    expect(component.isScoularListing(location({ elevator: undefined }))).toBe(false);
  });

  it('emits every ticked location, named and classified', () => {
    const emitted: any[] = [];
    component.addMany.subscribe(r => emitted.push(r));
    fixture.detectChanges();

    component.toggleSelected(location());
    component.toggleSelected(location({ locationKey: '4087', elevator: 'Scoular Company - Kansas', locationName: 'Salina, KS', city: 'Salina', state: 'KS' }));
    component.addSelected();

    expect(emitted[0]).toEqual({
      locations: [
        { locationKey: '82259', name: 'Grain Processing Corporation - GPC-MUSCATINE', isScoularFacility: false, existingLocationId: undefined },
        { locationKey: '4087', name: 'Scoular Company - Kansas - Salina', isScoularFacility: true, existingLocationId: undefined },
      ],
    });
  });

  it('carries the existing bid-sheet location id for a listing already added company-wide', () => {
    const emitted: any[] = [];
    component.addMany.subscribe(r => emitted.push(r));
    fixture.detectChanges();

    component.toggleSelected(location({ placements: [{ locationId: 55, tradeUnitCode: '2038', name: 'x' }] }));
    component.addSelected();

    expect(emitted[0].locations[0].existingLocationId).toBe(55);
  });

  it('adds nothing when nothing is ticked', () => {
    const emitted: any[] = [];
    component.addMany.subscribe(r => emitted.push(r));
    fixture.detectChanges();

    component.addSelected();

    expect(emitted).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Ticking is a running basket across searches. Resolving it against the current results dropped
  // everything picked before the last pan -- silently, while the footer went on counting them.

  it('keeps a ticked location when the search has moved past it', () => {
    fixture.detectChanges();
    const gone = location({ locationKey: '99999', elevator: 'Far Away Co-op' });
    component.toggleSelected(gone);

    // The user pans; a completely different set comes back.
    apiMock.searchBarchartLocations.mockReturnValue(of([location()]));
    component.onStateChange('IL');

    expect(component.selectedCount()).toBe(1);
    expect(component.offListSelected().map(l => l.locationKey)).toEqual(['99999']);
  });

  it('adds a location the search has moved past', () => {
    const emitted: any[] = [];
    component.addMany.subscribe(r => emitted.push(r));
    fixture.detectChanges();
    component.toggleSelected(location({ locationKey: '99999', elevator: 'Far Away Co-op' }));

    apiMock.searchBarchartLocations.mockReturnValue(of([location()]));
    component.onStateChange('IL');
    component.addSelected();

    expect(emitted[0].locations.map((l: any) => l.locationKey)).toEqual(['99999']);
  });

  it('does not repeat a ticked location that is still on screen', () => {
    fixture.componentRef.setInput('searchArea', { latitude: 41.4, longitude: -91, radiusMiles: 25 });
    fixture.detectChanges();

    component.toggleSelected(location());

    expect(component.selectedCount()).toBe(1);
    expect(component.offListSelected()).toEqual([]);
  });

  it('unticks on a second click and empties the basket on clear', () => {
    fixture.detectChanges();
    component.toggleSelected(location());
    component.toggleSelected(location());
    expect(component.selectedCount()).toBe(0);

    component.toggleSelected(location());
    component.clearSelection();

    expect(component.selectedCount()).toBe(0);
    expect(component.offListSelected()).toEqual([]);
  });
  // -------------------------------------------------------------------------
  // A listing already added company-wide (has a placement) is still tickable -- ticking it just
  // links the existing row to this sheet. Only ALREADY ON THIS SHEET disables the checkbox.

  it('reads the existing bid-sheet location id off a listing\'s placement', () => {
    const loc = location({ placements: [{ locationId: 55, tradeUnitCode: '2038', name: 'x' }] });
    expect(component.existingLocationId(loc)).toBe(55);
    expect(component.existingLocationId(location({ placements: [] }))).toBeNull();
  });

  it('refuses to tick a location already on the active sheet', () => {
    fixture.componentRef.setInput('sheetLocationIds', new Set([55]));
    fixture.detectChanges();
    const onSheet = location({ placements: [{ locationId: 55, tradeUnitCode: '2038', name: 'x' }] });

    component.toggleSelected(onSheet);

    expect(component.selectedCount()).toBe(0);
    expect(component.alreadyOnSheet(onSheet)).toBe(true);
  });

  it('still ticks a listing that exists company-wide but is not yet on this sheet', () => {
    fixture.componentRef.setInput('sheetLocationIds', new Set([99]));
    fixture.detectChanges();
    const elsewhere = location({ placements: [{ locationId: 55, tradeUnitCode: '2038', name: 'x' }] });

    component.toggleSelected(elsewhere);

    expect(component.selectedCount()).toBe(1);
    expect(component.alreadyOnSheet(elsewhere)).toBe(false);
  });
});
