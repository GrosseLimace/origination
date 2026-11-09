import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { defaultIfEmpty } from 'rxjs/operators';
import { DashboardSummary } from '@models';
import { ApiService } from '@core/services/api.service';
import { PermissionService } from '@core/access/permission.service';
import { DashboardStore } from './data-access/dashboard.store';
import { preloadDashboardSummary } from './producers.module';

describe('Producers preload: the Planting Dashboard summary', () => {
  const summary: DashboardSummary = { estimates: [], marketShares: [], actualHarvest: [] };
  let api: { getDashboardSummary: ReturnType<typeof vi.fn> };
  let canRead: boolean;

  function run(tradeUnits: string[]): Promise<unknown> {
    return firstValueFrom(
      TestBed.runInInjectionContext(() => preloadDashboardSummary(tradeUnits) as Observable<unknown>).pipe(defaultIfEmpty('none')),
    );
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T12:00:00'));
    canRead = true;
    api = { getDashboardSummary: vi.fn(() => of(summary)) };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: PermissionService, useValue: { loaded: () => of('loaded'), has: () => canRead } },
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  it('pre-fetches the dashboard summary under the sorted trade-unit key for the current year', async () => {
    await run(['2190', '1085']);

    expect(api.getDashboardSummary).toHaveBeenCalledWith('1085,2190', 2026);
    expect(TestBed.inject(DashboardStore).preloadedDashboardSummary()).toEqual({ tradeUnitsKey: '1085,2190', year: 2026, ...summary });
  });

  it('a failed prefetch is left unset, so the dashboard fetches its own instead of showing an empty season', async () => {
    api.getDashboardSummary.mockReturnValue(throwError(() => new Error('500')));

    await run(['1085']);

    expect(TestBed.inject(DashboardStore).preloadedDashboardSummary()).toBeNull();
  });

  it('makes no call for a user who may not read the dashboard, so nobody else gets a 403 on every trade-unit change', async () => {
    canRead = false;

    await run(['1085']);

    expect(api.getDashboardSummary).not.toHaveBeenCalled();
  });

  it('drops the previous selection\'s caches before it fetches', async () => {
    const store = TestBed.inject(DashboardStore);
    store.setPreloadedDashboardSummary('1085', 2026, summary);
    store.setDashboardCache({ tradeUnitsKey: '1085', year: 2026 } as never);
    canRead = false;

    await run(['2190']);

    expect(store.preloadedDashboardSummary()).toBeNull();
    expect(store.dashboardCache()).toBeNull();
  });
});
