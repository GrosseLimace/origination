import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import type { DashboardPlantingEstimate } from '@models';
import { SessionReset } from '@core/auth/session-reset.service';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { PermissionStub, permissionStub, providePermissions } from '@testing/permission.stub';
import { ProducersApiService } from './producers-api.service';
import { YieldEstimateStore } from './yield-estimate.store';

const estimate = (crop: string, plantingYear: number, yieldPerAcre = 200) =>
  ({ crop, plantingYear, yieldPerAcre }) as unknown as DashboardPlantingEstimate;

/**
 * The selected trade units' yield estimates, read a year at a time as Producers' preload and the selected producer's
 * production ask for them.
 */
describe('YieldEstimateStore', () => {
  let store: YieldEstimateStore;
  let api: { getDashboardPlantingEstimates: ReturnType<typeof vi.fn<(key: string, year: number) => Observable<DashboardPlantingEstimate[]>>> };
  let access: PermissionStub;
  let tradeUnits: TradeUnitContext;

  const years = () => store.estimates().map(e => e.plantingYear).sort();

  beforeEach(() => {
    api = { getDashboardPlantingEstimates: vi.fn((_key: string, year: number) => of([estimate('YC', year)])) };
    access = permissionStub(['planting-estimates:read']);
    TestBed.configureTestingModule({
      providers: [{ provide: ProducersApiService, useValue: api }, providePermissions(access)],
    });
    tradeUnits = TestBed.inject(TradeUnitContext);
    tradeUnits.setTradeUnits(['2190', '1085']);
    store = TestBed.inject(YieldEstimateStore);
  });

  it('reads each year asked for once, under the sorted trade-unit key', () => {
    store.load([2026, 2025]);
    store.load([2026, 2027]);

    expect(api.getDashboardPlantingEstimates.mock.calls).toEqual([['1085,2190', 2026], ['1085,2190', 2025], ['1085,2190', 2027]]);
    expect(years()).toEqual([2025, 2026, 2027]);
  });

  it('keeps one estimate per crop and year', () => {
    api.getDashboardPlantingEstimates.mockImplementation((_key, year) => of([estimate('YC', year), estimate('SB', year, 50)]));

    store.load([2026]);

    expect(store.estimates().map(e => `${e.crop}|${e.plantingYear}`).sort()).toEqual(['SB|2026', 'YC|2026']);
  });

  it('a new selection of trade units drops what was read for the last one, and reads its own', () => {
    store.load([2026]);

    tradeUnits.setTradeUnits(['3000']);
    store.load([2026]);

    expect(api.getDashboardPlantingEstimates).toHaveBeenLastCalledWith('3000', 2026);
    expect(api.getDashboardPlantingEstimates).toHaveBeenCalledTimes(2);
  });

  it('drops an answer for trade units no longer selected', () => {
    const late = new Subject<DashboardPlantingEstimate[]>();
    api.getDashboardPlantingEstimates.mockReturnValueOnce(late);
    store.load([2026]);
    tradeUnits.setTradeUnits(['3000']);
    store.load([2027]);

    late.next([estimate('YC', 2026)]);
    late.complete();

    expect(years()).toEqual([2027]);
    expect(store.isLoading()).toBe(false);
  });

  it('is loading while a read runs', () => {
    const answer = new Subject<DashboardPlantingEstimate[]>();
    api.getDashboardPlantingEstimates.mockReturnValueOnce(answer);

    store.load([2026]);
    expect(store.isLoading()).toBe(true);

    answer.next([estimate('YC', 2026)]);
    answer.complete();
    expect(store.isLoading()).toBe(false);
  });

  it('a failed year reads as none, and the other years still land', () => {
    api.getDashboardPlantingEstimates.mockImplementation((_key, year) =>
      year === 2025 ? throwError(() => new Error('500')) : of([estimate('YC', year)]));

    store.load([2026, 2025]);

    expect(years()).toEqual([2026]);
    expect(store.isLoading()).toBe(false);
  });

  it('reads nothing for a user who may not read planting estimates, or with no trade units', () => {
    access.grant();
    store.load([2026]);
    access.grant('planting-estimates:read');
    tradeUnits.setTradeUnits([]);
    store.load([2026]);

    expect(api.getDashboardPlantingEstimates).not.toHaveBeenCalled();
    expect(store.estimates()).toEqual([]);
  });

  it('drops everything at sign-out', () => {
    store.load([2026]);

    TestBed.inject(SessionReset).reset();

    expect(store.estimates()).toEqual([]);
  });
});
