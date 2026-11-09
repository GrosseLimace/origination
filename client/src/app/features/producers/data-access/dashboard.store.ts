import { Injectable, signal } from '@angular/core';
import { Customer, Contract, PlantingIntention, StoredGrain, Commodity, DashboardPlantingEstimate, DashboardMarketShare, DashboardActualHarvest, DashboardSummary } from '@models';

export interface DashboardCacheEntry {
  tradeUnitsKey: string;
  /** Planting year the year-specific entries below were loaded for. Part of the cache key: the
   *  dashboard resets selectedPlantingYear to the current year on every construction while this
   *  cache survives navigation, so matching on tradeUnitsKey alone re-applied another year's
   *  estimates/market shares/harvest figures. */
  year: number;
  customers: Customer[];
  contracts: Contract[];
  plantingIntentions: PlantingIntention[];
  storedGrain: StoredGrain[];
  commodities: Commodity[];
  savedYieldEstimates: DashboardPlantingEstimate[];
  savedMarketShares: DashboardMarketShare[];
  savedActualHarvest: DashboardActualHarvest[];
  loadedAt: Date;
}

/** The Planting Dashboard's caches: its last load, and the summary the preload fetched for the current year. */
@Injectable({ providedIn: 'root' })
export class DashboardStore {
  private readonly _dashboardCache = signal<DashboardCacheEntry | null>(null);
  private readonly _preloadedDashboardSummary = signal<(DashboardSummary & { tradeUnitsKey: string; year: number }) | null>(null);

  // Dashboard cache — keyed by trade unit so navigating back shows data instantly
  readonly dashboardCache = this._dashboardCache.asReadonly();

  setDashboardCache(entry: DashboardCacheEntry): void {
    this._dashboardCache.set(entry);
  }

  clearDashboardCache(): void {
    this._dashboardCache.set(null);
  }

  // Pre-fetched dashboard summary — the module's preload populates this for the current year
  // so the dashboard component can render without waiting for its own API calls.
  readonly preloadedDashboardSummary = this._preloadedDashboardSummary.asReadonly();

  setPreloadedDashboardSummary(tradeUnitsKey: string, year: number, summary: DashboardSummary): void {
    this._preloadedDashboardSummary.set({ tradeUnitsKey, year, ...summary });
  }

  clearPreloadedDashboardSummary(): void {
    this._preloadedDashboardSummary.set(null);
  }
}
