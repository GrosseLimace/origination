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

  it('defaults the saved name to the vendor site name', () => {
    fixture.detectChanges();
    component.openDetail('82259');
    expect(component.nameOverride()).toBe('GPC-MUSCATINE');
  });

  it('falls back to the company, then the key, when a site name is missing', () => {
    expect(component.defaultName(location({ locationName: undefined }))).toBe('Grain Processing Corporation');
    expect(component.defaultName(location({ locationName: undefined, elevator: undefined }))).toBe('BarChart 82259');
  });

  it('emits the add request with the chosen trade units', () => {
    const emitted: any[] = [];
    component.add.subscribe(r => emitted.push(r));
    fixture.componentRef.setInput('tradeUnits', ['2190', '4056']);
    fixture.detectChanges();
    component.openDetail('82259');
    component.toggleTu('4056');

    component.confirmAdd();

    expect(emitted[0]).toEqual({ locationKey: '82259', name: 'GPC-MUSCATINE', tradeUnitCodes: ['4056'] });
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
});
