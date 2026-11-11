import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AppStateService } from '@core/services/app-state.service';
import { DashboardCacheEntry, DashboardStore } from './dashboard.store';

describe('DashboardStore', () => {
  it('drops both caches when the session ends', () => {
    const store = TestBed.inject(DashboardStore);
    store.setDashboardCache({ tradeUnitsKey: '1084', year: 2026, loadedAt: new Date() } as DashboardCacheEntry);
    store.setPreloadedDashboardSummary('1084', 2026, { estimates: [], marketShares: [], actualHarvest: [] } as never);

    TestBed.inject(AppStateService).clearAll();

    expect(store.dashboardCache()).toBeNull();
    expect(store.preloadedDashboardSummary()).toBeNull();
  });
});
