import { Provider, signal } from '@angular/core';
import { vi } from 'vitest';
import { DpContract, PlantingIntention, StoredGrain } from '@models';
import { SelectedProducerProduction } from '@core/context/selected-producer-production';

/**
 * A SelectedProducerProduction for specs: writable signals a test sets directly, and a spy per action. Starts with no
 * planting intentions, stored grain or DP contracts, nothing loading, and no crop year picked (0).
 */
export function selectedProducerProductionFake() {
  return {
    visiblePlantingIntentions: signal<PlantingIntention[]>([]),
    isLoadingPlanting: signal(false),
    plantingYears: signal<number[]>([]),
    selectedPlantingYear: signal(0),
    selectPlantingYear: vi.fn(),
    commodityCodes: signal<string[]>([]),
    tradeUnits: signal<string[]>([]),
    addPlantingIntention: vi.fn(),
    editPlantingIntention: vi.fn(),
    deletePlantingIntention: vi.fn(),
    storedGrain: signal<StoredGrain[]>([]),
    isLoadingStoredGrain: signal(false),
    dpContracts: signal<DpContract[]>([]),
    isLoadingDpContracts: signal(false),
  } satisfies SelectedProducerProduction;
}

export type SelectedProducerProductionFake = ReturnType<typeof selectedProducerProductionFake>;

/** Provides `fake` (or an empty one) as the SelectedProducerProduction. */
export function provideSelectedProducerProduction(fake: SelectedProducerProductionFake = selectedProducerProductionFake()): Provider {
  return { provide: SelectedProducerProduction, useValue: fake };
}
