// Public API of the Producers module: the only file another module may import from it. eslint.config.js enforces that,
// and which modules may import it at all.

// What Lists' NLQ engine, filters and result rows reckon with, the same way the producer screens do: grain on farm and
// bin sites, production against contracts, DP contracts, and the planting category a commodity falls in.
export { isGrainAndBinSitesCategory, binSiteGrainBreakdown, formatLastBid } from './utils/grain-on-farm';
export type { BinSiteGrainGroup } from './utils/grain-on-farm';
export { buildLbsPerBushelMap, findYieldEstimate, sumInBushels } from './utils/production-coverage';
export { dpBreakdownByCrop, dpTotalBushels, dpTotalCharges, dpContractCount } from './utils/dp-aggregate';
export { plantingCategory, commodityPlantingCategory } from './utils/planting-category';

// The trade units' planting intentions, stored grain and DP contracts, which Lists' screens and saved lists read, and
// the calls they and a crop year's yield estimates are read with. The customer screen reads the selected producer's
// through SelectedProducerProduction in core.
export { ProducerStore } from './data-access/producer.store';
export { ProducersApiService } from './data-access/producers-api.service';
