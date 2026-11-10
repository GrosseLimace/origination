import { Signal } from '@angular/core';
import { Customer } from '@models';

/** One save of the Edit Producer Details dialog: the producer's details, their links, and their trade units. */
export interface ProducerEdit {
  customerId: number;
  /** The producer code, sent only for an onboarding candidate: a candidate from the CTRM search has a placeholder id,
   *  and the server onboards it by this code. */
  scoularId?: string;
  acres: number;
  /** The commodities the user added; those from the producer's tickets and contracts are derived, never saved. */
  commodities: string[];
  /** From the primary contact, so what updates the page and the linked producers needn't work it out again. */
  primaryContact: string;
  primaryPhone: string;
  contacts: { name: string; phone?: string; email?: string; isPrimary: boolean }[];
  /** At full precision, in display order. Capacity in bushels. */
  binSites: { siteKey: string; name: string; latitude?: number; longitude?: number; capacity?: number }[];
  linkedProducerIds: string[];
  /** Producers linking to this one whose link the user removed. */
  removedIncomingIds: string[];
  eSignEnabled: boolean;
  /** The producer's manual trade units as they should be once saved. */
  tradeUnitCodes: string[];
  /** Whether to save the trade units: when it is safe and something changed. */
  reconcileTradeUnits: boolean;
  grainOnFarm: { binSiteKey?: string; commodityCode: string; bushelsOnHand?: number; bushelsSold?: number; targetBushels?: number; lastBid?: number; grade?: string }[];
  /** Planting intentions to move off a trade unit being removed; none when left out. The page runs them, because it
   *  holds the intention lists the profile shows. */
  intentionMoves?: { from: string; to: string }[];
}

/**
 * What the Edit Producer Details dialog needs from the page hosting the customer screen: the producers the page has
 * loaded, which its Link Producers search offers, and the page's save, which keeps the page's lists up to date as it
 * goes. Declared in core so the dialog can use it without importing the page; the home page provides it.
 */
export abstract class ProducerEditing {
  /** The producers in the page's trade units, which the link search offers. */
  abstract readonly producers: Signal<Customer[]>;
  /** The trade units those producers are from. With none, the search offers every producer, read on its own. */
  abstract readonly producersTradeUnits: Signal<string[]>;
  /** The selected producer's trade-unit save is still running: the dialog keeps Save off meanwhile. */
  abstract readonly saving: Signal<boolean>;
  /** Saves an edit: the trade units first when they changed, then the details and links, then the intention moves. */
  abstract save(edit: ProducerEdit): void;
}
