import { Signal } from '@angular/core';
import { Customer, DashboardPlantingEstimate, DpContract, PlantingIntention, PlantingIntentionDraft, PlantingIntentionEdit, StoredGrain } from '@models';

/** How a producer is selected: the crop year a deep link asked for, and whether their planting is read again rather
 *  than shown from what was read before. */
export interface ProducerSelection {
  plantingYear?: number | null;
  reread?: boolean;
}

/** One trade unit's planting intentions moved to another, as a trade-unit edit asks. */
export interface PlantingIntentionMove {
  from: string;
  to: string;
}

/**
 * The selected producer's production, as the customer screen's pieces read it: their planting intentions and the
 * planting year being looked at, the yield estimates their production is projected with, their stored grain and their
 * DP contracts. Declared in core so those pieces (the Planting, Storage and DP Contracts tabs and the producer panels)
 * can read it without importing the module that holds it. The Producers module's ProducerProductionStore is the
 * implementation, which the composition root provides, and which also keeps the planting-year selection the Planting
 * tab and the producer panels share; the page that hosts the customer screen tells it who is selected.
 */
export abstract class SelectedProducerProduction {
  /**
   * The producer the customer screen now shows, or null for none: reads their planting intentions (from what was read
   * before, unless `reread`), stored grain and DP contracts, and starts the crop-year selection over, on the year a
   * deep link asked for or else the newest. Cancels what was still being read for the producer before.
   */
  abstract select(customer: Customer | null, options?: ProducerSelection): void;
  /** Moves a producer's planting intentions off trade units a trade-unit edit removed, then reads them again. */
  abstract movePlantingIntentions(customerId: number, moves: readonly PlantingIntentionMove[]): void;

  /** Every planting intention the producer has, in every crop year. */
  abstract readonly plantingIntentions: Signal<PlantingIntention[]>;
  /** The producer's planting intentions in the years the profile shows. */
  abstract readonly visiblePlantingIntentions: Signal<PlantingIntention[]>;
  /** True while the planting intentions load. */
  abstract readonly isLoadingPlanting: Signal<boolean>;
  /** The crop years offered, newest first. */
  abstract readonly plantingYears: Signal<number[]>;
  /** The crop year being looked at; 0 before there is one. */
  abstract readonly selectedPlantingYear: Signal<number>;
  /** Picks a crop year: the Planting tab and the producer panels follow it. */
  abstract selectPlantingYear(year: number): void;

  /** The trade units' yield estimates per crop and year, which project the producer's production from their intentions. */
  abstract readonly yieldEstimates: Signal<DashboardPlantingEstimate[]>;
  /** True while the yield estimates load. */
  abstract readonly isLoadingEstimates: Signal<boolean>;

  /** Commodity codes the producer deals in, from their tickets and their profile. */
  abstract readonly commodityCodes: Signal<string[]>;
  /** The trade units the user is working in, which a new planting intention can be tagged with. */
  abstract readonly tradeUnits: Signal<string[]>;

  abstract addPlantingIntention(intention: PlantingIntentionDraft): void;
  abstract editPlantingIntention(edit: PlantingIntentionEdit): void;
  abstract deletePlantingIntention(intentionId: number): void;

  /** The producer's stored grain. */
  abstract readonly storedGrain: Signal<StoredGrain[]>;
  /** True while the stored grain loads. */
  abstract readonly isLoadingStoredGrain: Signal<boolean>;
  /** The producer's DP contracts. */
  abstract readonly dpContracts: Signal<DpContract[]>;
  /** True while the DP contracts load. */
  abstract readonly isLoadingDpContracts: Signal<boolean>;
}
