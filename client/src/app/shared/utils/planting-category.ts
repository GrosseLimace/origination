import { Commodity, PlantingIntention } from '@models';

/**
 * Single source of truth for the crop label a planting intention is grouped and displayed under —
 * the dashboard's crop breakdown / season targets / contract coverage, the producer's planting
 * table, the print report and Build-A-List's coverage prompts all resolve through here so they
 * agree with each other (they used to disagree: the dashboard honoured the row's stored category
 * while the table and print report only ever read the commodity's).
 *
 * Why this isn't just `Commodity.category`: that column is the ODS commodity GROUP and is the
 * app-wide crop-group key (Build-A-List crop chips, NLQ, bid-sheet palette, grain on farm). For the
 * organics it is the base crop — YSBO ORGANIC SOYBEANS sits under "Soybeans" — which is right for
 * matching a "Soybeans" chip but wrong on the planting dashboard, where organic acres, season
 * targets and contract coverage were being folded into the conventional crop. The same goes for
 * the IP grades: YWC WAXY CORN is a distinct product with its own contracts, not "Corn". The
 * server-side `Commodity.plantingCategory` override ("Organic Soybeans", "Waxy Corn") narrows the
 * fix to planting.
 */

/** The label a commodity groups under on the planting surfaces: its planting override when set,
 *  else its broad category. Use this for the CONTRACT side of a coverage calculation so contracts
 *  group by the same label as the intentions they are compared against. */
export function commodityPlantingCategory(commodity: Commodity | null | undefined): string | undefined {
  const planting = (commodity?.plantingCategory || '').trim();
  if (planting) return planting;
  const base = (commodity?.category || '').trim();
  return base || undefined;
}

/**
 * The label for one planting intention. Precedence:
 *   1. an explicit per-row override — a stored category that is NOT the commodity's own broad
 *      category (e.g. "Non-GMO Soybeans" picked from the tier dropdown). The add/edit form
 *      auto-fills the broad category, so a stored value equal to it is just that default and
 *      defers to the commodity, which is what lets rows saved before the organics had their
 *      own label ("Soybeans" on a YSBO row) resolve to "Organic Soybeans" without being edited;
 *   2. the commodity's planting label (`commodityPlantingCategory`);
 *   3. the stored category as-is, then the raw crop code — for a code no longer in the lookup.
 */
export function plantingCategory(
  intention: Pick<PlantingIntention, 'crop' | 'category'>,
  commodity: Commodity | null | undefined,
): string {
  const stored = (intention.category || '').trim();
  const base = (commodity?.category || '').trim();
  if (stored && (!base || stored.toLowerCase() !== base.toLowerCase())) return stored;
  return commodityPlantingCategory(commodity) || stored || (intention.crop || '').trim();
}
