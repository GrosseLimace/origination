import { Signal } from '@angular/core';
import { DpContract, PlantingIntention, PlantingIntentionDraft, PlantingIntentionEdit, StoredGrain } from '@models';

/**
 * The selected producer's production, as the customer screen's pieces read it: their planting intentions and the
 * planting year being looked at, their stored grain and their DP contracts. Declared in core so those pieces (the
 * Planting, Storage and DP Contracts tabs) can read it without importing the module that holds it. The customer
 * profile provides it to everything rendered inside it, implemented by the profile itself, which owns the
 * planting-year selection the Planting tab and the producer panels share.
 */
export abstract class SelectedProducerProduction {
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
