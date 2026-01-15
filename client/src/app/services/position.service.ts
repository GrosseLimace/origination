import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { PositionData, HedgePosition } from '../models';

/**
 * Service for managing grain position and hedge data.
 * Provides mock data for development; will connect to API in production.
 */
@Injectable({
  providedIn: 'root'
})
export class PositionService {
  private positionData: PositionData[] = [
    {
      commodity: 'Corn',
      deliveryWindow: 'Dec 2024',
      location: 'Iowa County, IA',
      cashBid: 4.45,
      futuresPrice: 4.65,
      basis: -0.20,
      purchasedBushels: 150000,
      hedgedBushels: 120000,
      netPosition: 30000,
      averagePurchasePrice: 4.40,
      averageHedgePrice: 4.60,
      grossMargin: 7500,
      openContracts: 3
    },
    {
      commodity: 'Corn',
      deliveryWindow: 'Jan-Feb 2025',
      location: 'Iowa County, IA',
      cashBid: 4.50,
      futuresPrice: 4.75,
      basis: -0.25,
      purchasedBushels: 80000,
      hedgedBushels: 80000,
      netPosition: 0,
      averagePurchasePrice: 4.45,
      averageHedgePrice: 4.70,
      grossMargin: 20000,
      openContracts: 2
    },
    {
      commodity: 'Soybeans',
      deliveryWindow: 'Nov 2024',
      location: 'Champaign County, IL',
      cashBid: 11.85,
      futuresPrice: 12.15,
      basis: -0.30,
      purchasedBushels: 60000,
      hedgedBushels: 50000,
      netPosition: 10000,
      averagePurchasePrice: 11.75,
      averageHedgePrice: 12.10,
      grossMargin: 6000,
      openContracts: 2
    },
    {
      commodity: 'Wheat',
      deliveryWindow: 'Dec 2024',
      location: 'Lancaster County, NE',
      cashBid: 5.65,
      futuresPrice: 5.90,
      basis: -0.25,
      purchasedBushels: 25000,
      hedgedBushels: 25000,
      netPosition: 0,
      averagePurchasePrice: 5.60,
      averageHedgePrice: 5.85,
      grossMargin: 6250,
      openContracts: 1
    },
    {
      commodity: 'Corn',
      deliveryWindow: 'Dec 2024',
      location: 'Champaign County, IL',
      cashBid: 4.48,
      futuresPrice: 4.65,
      basis: -0.17,
      purchasedBushels: 100000,
      hedgedBushels: 80000,
      netPosition: 20000,
      averagePurchasePrice: 4.42,
      averageHedgePrice: 4.62,
      grossMargin: 6000,
      openContracts: 2
    },
    {
      commodity: 'Soybeans',
      deliveryWindow: 'Jan-Feb 2025',
      location: 'Story County, IA',
      cashBid: 12.00,
      futuresPrice: 12.35,
      basis: -0.35,
      purchasedBushels: 40000,
      hedgedBushels: 40000,
      netPosition: 0,
      averagePurchasePrice: 11.90,
      averageHedgePrice: 12.30,
      grossMargin: 16000,
      openContracts: 1
    }
  ];

  private hedgePositions: HedgePosition[] = [
    {
      id: 'H001',
      commodity: 'Corn',
      contractMonth: 'Dec 2024 (CZ24)',
      position: 'Short',
      contracts: 24,
      bushels: 120000,
      entryPrice: 4.60,
      currentPrice: 4.65,
      unrealizedPL: -6000
    },
    {
      id: 'H002',
      commodity: 'Corn',
      contractMonth: 'Mar 2025 (CH25)',
      position: 'Short',
      contracts: 16,
      bushels: 80000,
      entryPrice: 4.70,
      currentPrice: 4.75,
      unrealizedPL: -4000
    },
    {
      id: 'H003',
      commodity: 'Soybeans',
      contractMonth: 'Nov 2024 (SX24)',
      position: 'Short',
      contracts: 10,
      bushels: 50000,
      entryPrice: 12.10,
      currentPrice: 12.15,
      unrealizedPL: -2500
    },
    {
      id: 'H004',
      commodity: 'Wheat',
      contractMonth: 'Dec 2024 (WZ24)',
      position: 'Short',
      contracts: 5,
      bushels: 25000,
      entryPrice: 5.85,
      currentPrice: 5.90,
      unrealizedPL: -1250
    },
    {
      id: 'H005',
      commodity: 'Corn',
      contractMonth: 'Dec 2024 (CZ24)',
      position: 'Short',
      contracts: 16,
      bushels: 80000,
      entryPrice: 4.62,
      currentPrice: 4.65,
      unrealizedPL: -2400
    },
    {
      id: 'H006',
      commodity: 'Soybeans',
      contractMonth: 'Mar 2025 (SH25)',
      position: 'Short',
      contracts: 8,
      bushels: 40000,
      entryPrice: 12.30,
      currentPrice: 12.35,
      unrealizedPL: -2000
    }
  ];

  /** Returns all grain position data as an Observable */
  getPositionData(): Observable<PositionData[]> {
    return of(this.positionData);
  }

  /** Returns all hedge positions as an Observable */
  getHedgePositions(): Observable<HedgePosition[]> {
    return of(this.hedgePositions);
  }

  /** Returns unique list of grain locations */
  getLocations(): string[] {
    return [...new Set(this.positionData.map(p => p.location))];
  }

  /** Returns unique list of commodity types */
  getCommodities(): string[] {
    return [...new Set(this.positionData.map(p => p.commodity))];
  }
}
