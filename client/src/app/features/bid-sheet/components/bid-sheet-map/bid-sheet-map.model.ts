/**
 * View-model consumed identically by BOTH the Leaflet and MapLibre Bid Sheet map rendering paths
 * (see docs/poc/bid-sheet-map/03-frontend-components.md — "Component split"). Built by
 * `BidSheetComponent.mapRenderModel`, a pure function of the parent's existing bid/status/filter
 * signals. Neither rendering path may recompute bid-status/color logic itself — both only draw
 * from this shape, which is the mechanism behind the doc's compatibility guarantee that the two
 * engines can never visually drift from one another.
 *
 * Not a persisted entity — display-only, rebuilt on every relevant signal change.
 */
export interface BidSheetMapRenderGroup {
  /** True coordinate for this group (before any zoom-dependent screen-space "spread" declutter,
   *  which each rendering engine applies itself using its own project()/unproject()). */
  lat: number;
  lng: number;
  /** Location names sharing this coordinate (rounded to 3 decimal places, matching today's grouping). */
  names: string[];
  /** Which visual form this group renders as at the current zoom/search/filter state. */
  pinKind: 'dot' | 'bidPills' | 'nameLabels' | 'expanded';
  /** Per-name (or, for 'dot', a single-entry) label/color list — empty for 'expanded' (which uses `hover` instead). */
  items: { label: string; bg: string; border: string }[];
  /** The "hover expand" / "panel-open expanded" callout content — name + bid value + color. */
  hover: { name: string; bid: string; bg: string; border: string };
  /** True when this group's location is the one currently open in the detail panel. */
  isPanelOpen: boolean;
}

export interface BidSheetMapRenderModel {
  groups: BidSheetMapRenderGroup[];
}
