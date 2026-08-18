import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';

import { BarchartPickerComponent } from './barchart-picker.component';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { BarchartCatalogLocation, BarchartCatalogLocationDetail, BarchartCoverage } from '@models';

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

function detail(overrides: Partial<BarchartCatalogLocationDetail> = {}): BarchartCatalogLocationDetail {
  return {
    location: location(),
    bids: [],
    unmappedBidCount: 0,
    ...overrides,
  };
}

describe('BarchartPickerComponent', () => {
  let component: BarchartPickerComponent;
  let fixture: ComponentFixture<BarchartPickerComponent>;

  const apiMock = {
    getBarchartCoverage: vi.fn(),
    searchBarchartLocations: vi.fn(),
    getBarchartLocation: vi.fn(),
  };
  const toastMock = { error: vi.fn(), success: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    apiMock.getBarchartCoverage.mockReturnValue(of(coverage));
    apiMock.searchBarchartLocations.mockReturnValue(of([location()]));
    apiMock.getBarchartLocation.mockReturnValue(of(detail()));

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

  // One trade unit is unambiguous, so pre-tick it. With several, requiring a choice keeps a location
  // from quietly landing on the wrong desk.
  it('pre-selects the only available trade unit', () => {
    fixture.componentRef.setInput('tradeUnits', ['2190']);
    fixture.detectChanges();

    component.openDetail('82259');

    expect([...component.chosenTus()]).toEqual(['2190']);
  });

  it('leaves trade units unticked when there is more than one', () => {
    fixture.componentRef.setInput('tradeUnits', ['2190', '4056']);
    fixture.detectChanges();

    component.openDetail('82259');

    expect(component.chosenTus().size).toBe(0);
    expect(component.canAdd()).toBe(false);
  });

  it('never pre-selects nor allows a trade unit the location is already on', () => {
    apiMock.getBarchartLocation.mockReturnValue(of(detail({
      location: location({ placements: [{ locationId: 12, tradeUnitCode: '2190', name: 'GPC Muscatine' }] }),
    })));
    fixture.componentRef.setInput('tradeUnits', ['2190']);
    fixture.detectChanges();

    component.openDetail('82259');

    expect(component.chosenTus().size).toBe(0);
    expect(component.alreadyOn('2190')).toBe(true);
  });

  it('defaults the saved name to company plus site', () => {
    fixture.detectChanges();
    component.openDetail('82259');
    expect(component.nameOverride()).toBe('Grain Processing Corporation - GPC-MUSCATINE');
  });

  it('falls back through site, then the key, when the company is missing', () => {
    expect(component.defaultName(location({ elevator: undefined }))).toBe('GPC-MUSCATINE');
    // no trailing separator when only one half exists
    expect(component.defaultName(location({ elevator: undefined, locationName: undefined, city: undefined })))
      .toBe('BarChart 82259');
  });

  // 1,138 of the 2,894 listings have a site name that genuinely identifies one of a company's sites.
  it('headlines company and site, with the town on the second line', () => {
    const loc = location({ elevator: 'Farmers Cooperative Dorchester', locationName: 'HERKIMER', city: 'Marysville', state: 'KS' });

    expect(component.primaryName(loc)).toBe('Farmers Cooperative Dorchester - HERKIMER');
    expect(component.locationSubtitle(loc)).toBe('Marysville, KS');
  });

  // 1,483 of the 2,894 listings set the site name to the city. Keeping it would print the town twice,
  // once in the label and again on the line below it.
  it('drops the site from the label when the vendor just repeated the town', () => {
    const loc = location({ locationName: 'NORTON', city: 'Norton', state: 'KS', elevator: 'Ag Valley Co-op' });

    expect(component.primaryName(loc)).toBe('Ag Valley Co-op');
    expect(component.locationSubtitle(loc)).toBe('Norton, KS');
  });

  // Another 273 set it to the town AND state — "Salina, KS", "FARNSWORTH TX". Comparing raw strings
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

  it('emits the add request with the chosen trade units', () => {
    const emitted: any[] = [];
    component.add.subscribe(r => emitted.push(r));
    fixture.componentRef.setInput('tradeUnits', ['2190', '4056']);
    fixture.detectChanges();
    component.openDetail('82259');
    component.toggleTu('4056');

    component.confirmAdd();

    expect(emitted[0]).toEqual({
      locationKey: '82259',
      name: 'Grain Processing Corporation - GPC-MUSCATINE',
      tradeUnitCodes: ['4056'],
    });
    expect(component.saving()).toBe(true);
  });

  // The parent owns the create call, so the button has to be released whichever way it ends —
  // otherwise a failed add leaves the picker stuck on "Adding…".
  it('releases the add button after a failed add and keeps the confirm step open', () => {
    fixture.componentRef.setInput('tradeUnits', ['2190']);
    fixture.detectChanges();
    component.openDetail('82259');
    component.confirmAdd();

    component.addFinished(false);

    expect(component.saving()).toBe(false);
    expect(component.detail()).not.toBeNull();
  });

  it('closes the confirm step after a successful add', () => {
    fixture.componentRef.setInput('tradeUnits', ['2190']);
    fixture.detectChanges();
    component.openDetail('82259');

    component.addFinished(true);

    expect(component.detail()).toBeNull();
    expect(component.chosenTus().size).toBe(0);
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

  it('formats a delivery month for the preview', () => {
    expect(component.monthLabel(2027, 1)).toBe('Jan 2027');
    expect(component.monthLabel(2026, 8)).toBe('Aug 2026');
  });

  // -------------------------------------------------------------------------
  // Trade-unit selector. Originators can hold a lot of desks, and the picker is opened from the map
  // with no trade unit chosen, so the list has to be searchable rather than just long.

  it('searches trade units by code', () => {
    fixture.componentRef.setInput('tradeUnits', ['2190', '4056', '3311']);
    fixture.detectChanges();

    component.tuSearch.set('40');

    expect(component.filteredTradeUnits()).toEqual(['4056']);
  });

  // Searching by where a desk is matters more than by its number — originators know "Pratt", not "2190".
  it('searches trade units by their location description', () => {
    fixture.componentRef.setInput('tradeUnits', ['2190', '4056']);
    fixture.componentRef.setInput('tradeUnitLabels', new Map([['2190', 'Pratt, KS'], ['4056', 'Hastings, NE']]));
    fixture.detectChanges();

    component.tuSearch.set('pratt');

    expect(component.filteredTradeUnits()).toEqual(['2190']);
    expect(component.tradeUnitDisplay('2190')).toBe('2190 · Pratt, KS');
  });

  it('shows every trade unit when the search is empty', () => {
    fixture.componentRef.setInput('tradeUnits', ['2190', '4056']);
    fixture.detectChanges();

    expect(component.filteredTradeUnits()).toEqual(['2190', '4056']);
  });

  it('summarises the selection for the closed selector', () => {
    fixture.componentRef.setInput('tradeUnits', ['2190', '4056']);
    fixture.componentRef.setInput('tradeUnitLabels', new Map([['2190', 'Pratt, KS']]));
    fixture.detectChanges();

    expect(component.tuSummary()).toBe('Select trade units');
    component.toggleTu('2190');
    expect(component.tuSummary()).toBe('2190 · Pratt, KS');
    component.toggleTu('4056');
    expect(component.tuSummary()).toBe('2 trade units');
  });

  // A second placement on a desk that already has this location would duplicate every fed bid, so the
  // toggle refuses it rather than relying on the checkbox being disabled in the template.
  it('refuses to select a trade unit the location is already on', () => {
    apiMock.getBarchartLocation.mockReturnValue(of(detail({
      location: location({ placements: [{ locationId: 12, tradeUnitCode: '2190', name: 'x' }] }),
    })));
    fixture.componentRef.setInput('tradeUnits', ['2190', '4056']);
    fixture.detectChanges();
    component.openDetail('82259');

    component.toggleTu('2190');

    // 4056 is pre-selected (it's the only desk this location isn't already on), so the set isn't empty —
    // what matters is that the already-placed 2190 never got in.
    expect(component.chosenTus().has('2190')).toBe(false);
    expect([...component.chosenTus()]).toEqual(['4056']);
  });

  it('clears the search when the selector is closed', () => {
    fixture.detectChanges();
    component.toggleTuPicker();
    component.tuSearch.set('pratt');

    component.toggleTuPicker();

    expect(component.tuPickerOpen()).toBe(false);
    expect(component.tuSearch()).toBe('');
  });
});
