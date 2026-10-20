/**
 * Bid sheet map — which pins to draw, and how.
 *
 * Pure decision logic behind the map refresh: group locations sharing a coordinate, drop the groups
 * the current filters hide, and pick each remaining group's presentation (expanded panel pin, dot,
 * bid pills or name label) with its icon, click target and hover content. The page still owns
 * Leaflet: it spreads overlapping positions, creates the markers and binds their events.
 */
import { BidSheetEntry, BidSheetLocation } from '@models';
import { BidStatus, computeItemStatus, lookupBid, parseBid } from './bid-math';
import {
  bidPillFill, bidPillsIcon, BidPillItem, dotIcon, EXPANDED_PIN_GREY, hoverIcon, MarkerIconOptions, nameLabelIcon, pinFill
} from './map-markers';

export interface MarkerPlanInput {
  /** Every map location (all trade units). */
  locations: BidSheetLocation[];
  activeTus: string[];
  crop: string;
  year: number;
  month: number;
  /** Session reference location name ('' = none). */
  refName: string;
  /** Location open in the side panel ('' = none). */
  panelOpenName: string;
  searchQuery: string;
  /** Names currently listed in the side panel. */
  panelNames: ReadonlySet<string>;
  /** View parity: a trade unit is active, or All Producers has derived crop-year data. */
  hasIndividualTu: boolean;
  zoom: number;
  scoularNames: ReadonlySet<string>;
  lookup: ReadonlyMap<string, BidSheetEntry>;
}

export interface PlannedMarker {
  /** True [lat, lng] of the group, before overlapping pins are spread apart. */
  position: [number, number];
  icon: MarkerIconOptions;
  /** Set only for the panel-open pin, which sits above the rest. */
  zIndexOffset?: number;
  /** The location a click selects. */
  target: BidSheetLocation;
  /** What the hover-expanded icon shows; null = no hover swap (the panel pin is already expanded). */
  hover: { name: string; bid: string; bg: string; border: string } | null;
}

export function planMarkers(input: MarkerPlanInput): PlannedMarker[] {
  const activeTus = input.activeTus;
  const hasTu = activeTus.length > 0;
  const zoom = input.zoom;
  const month = input.month;
  const getBid = (name: string, year: number | null, crop: string, m: number) => lookupBid(input.lookup, name, year, crop, m);

  const locKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const activeTuSet = new Set(activeTus);
  const crop = input.crop;
  const year = input.year;

  // Reference bid for status comparison — use selectedYear (same year used for bid pill lookups)
  const refName = input.refName;
  const refBid = parseBid(refName ? getBid(refName, year, crop, month) : '');

  // Search query — only filter map pins, panel stays full
  const searchQ = input.searchQuery.toLowerCase();

  // Scoular pins switch presentation on ONE thing: whether a reference location is set.
  //   no reference  → whole pin green (fill), no ring
  //   reference set → status fill (blue/red/yellow) + green ring
  // Keyed on refName, NOT on crop: picking a crop alone doesn't produce a comparison, and testing
  // crop here is what previously made the ring appear with no reference selected.
  const comparingToRef = !!refName;
  const scoularNames = input.scoularNames;

  // Group all map locations by coordinates
  const locsByPos = new Map<string, BidSheetLocation[]>();
  for (const loc of input.locations) {
    if (!loc.latitude || !loc.longitude) continue;
    const key = locKey(loc.latitude, loc.longitude);
    const arr = locsByPos.get(key) || [];
    arr.push(loc);
    locsByPos.set(key, arr);
  }

  const panelOpenName = input.panelOpenName;

  // Location names visible in the panel (respects crop/TU/search filters)
  const panelNames = input.panelNames;

  const hasIndividualTu = input.hasIndividualTu;

  // A dot / label takes its bid's beating/matching/none colour vs the reference while a reference
  // AND crop are being compared; null = no comparison running.
  const compareStatus = (name: string): BidStatus | null => {
    if (!(hasIndividualTu && refName && crop)) return null;
    const bidVal = getBid(name, year, crop, month);
    return bidVal ? computeItemStatus(bidVal, false, refBid) : 'none';
  };

  // Pass 1: decide which coordinate groups actually render a marker (apply the skip filters once)
  // and capture the per-group flags the draw pass needs.
  const renderGroups: { locs: BidSheetLocation[]; names: string[]; isActiveTu: boolean; isRef: boolean; isPanelOpen: boolean; }[] = [];
  for (const [, locs] of locsByPos) {
    // If searching, skip this pin group unless at least one location name matches
    if (searchQ && !locs.some(l => l.name.toLowerCase().includes(searchQ))) continue;
    const names = locs.map(l => l.name);
    // In All Producers (no TU filter) every location is "in scope"; with a TU, only its locations are.
    const isActiveTu = activeTuSet.size === 0 || locs.some(l => activeTuSet.has(l.tradeUnitCode ?? ''));
    const isRef = !!(hasIndividualTu && refName && names.includes(refName));
    const isPanelOpen = !!(panelOpenName && names.includes(panelOpenName));
    // When filters are active, only show locations that appear in the panel
    if (hasTu && !names.some(n => panelNames.has(n))) continue;
    // Skip locations with no bid for the selected crop/year/month
    if (crop && !names.some(n => getBid(n, year, crop, month))) continue;
    renderGroups.push({ locs, names, isActiveTu, isRef, isPanelOpen });
  }

  // Pass 2: pick each group's presentation.
  return renderGroups.map<PlannedMarker>(g => {
    const { locs, names, isActiveTu, isRef, isPanelOpen } = g;
    const position: [number, number] = [locs[0].latitude!, locs[0].longitude!];
    const target = locs[0];
    const showBidValues = isActiveTu && hasIndividualTu && crop;
    const hoverBid = crop ? getBid(locs[0].name, year, crop, month) : '';

    // Panel-open location — render expanded with name + bid (uses status color if reference, otherwise gray)
    if (isPanelOpen) {
      const bidStr = crop ? getBid(panelOpenName, year, crop, month) : '';
      // This pin represents panelOpenName specifically, so key it to that name rather than to
      // "any location at this coordinate".
      const panelIsScoular = scoularNames.has(panelOpenName);
      const status = hasIndividualTu && refName && bidStr ? computeItemStatus(bidStr, false, refBid) : null;
      const { bg: pinBg, border: pinBorder } = pinFill(isRef, status, panelIsScoular, EXPANDED_PIN_GREY);
      return { position, icon: hoverIcon(panelOpenName, bidStr, pinBg, pinBorder, scoularNames), zIndexOffset: 1000, target, hover: null };
    }

    // Below the bid-pin zoom threshold: colored dot — but when searching, always show name labels.
    // Lowered from 8 → 6 so the bid-value pins appear sooner (esp. in All Producers, which opens at
    // the wider US overview). Zoom 5 = national overview keeps dots; 6+ shows the bid pins.
    if (zoom < 6 && !searchQ) {
      // Dot stands for the whole coordinate group, so it counts as ours if ANY location here is.
      const dotIsScoular = names.some(n => scoularNames.has(n));
      // Compute dot color from bid status (matches the pill colors used when zoomed in)
      const { bg: color, border } = pinFill(isRef, compareStatus(locs[0].name), dotIsScoular);
      return { position, icon: dotIcon(color, border, comparingToRef && dotIsScoular), target, hover: { name: locs[0].name, bid: hoverBid, bg: color, border } };
    }

    if (showBidValues) {
      // Active TU with crop selected — show bid values with status colors
      const bidItems = names
        .map(n => {
          const isNameRef = hasIndividualTu && n === refName;
          const bidVal = getBid(n, year, crop, month);
          const nameIsScoular = scoularNames.has(n);
          if (!isNameRef && !bidVal) return null;
          const status = isNameRef ? 'reference' : computeItemStatus(bidVal, false, refBid);
          const { bg, border } = bidPillFill(isNameRef, status, nameIsScoular, comparingToRef);
          return { label: isNameRef ? bidVal || '--' : bidVal, bg, border, isScoular: nameIsScoular };
        })
        .filter((x): x is BidPillItem => x !== null);

      if (bidItems.length > 0) {
        return {
          position, icon: bidPillsIcon(bidItems, comparingToRef), target,
          hover: { name: locs[0].name, bid: hoverBid, bg: bidItems[0].bg, border: bidItems[0].border }
        };
      }
    }

    // Default: name labels — match the pill color story used elsewhere
    // Keyed to locs[0] specifically, not "any name here": this bg also drives the hover icon,
    // which shows locs[0]. Per-line fill for mixed groups is handled inside stackedLabelHtml.
    const labelIsScoular = scoularNames.has(locs[0].name);
    const { bg, border } = pinFill(isRef, compareStatus(locs[0].name), labelIsScoular);
    return { position, icon: nameLabelIcon(names, bg, border, comparingToRef, scoularNames), target, hover: { name: locs[0].name, bid: hoverBid, bg, border } };
  });
}
