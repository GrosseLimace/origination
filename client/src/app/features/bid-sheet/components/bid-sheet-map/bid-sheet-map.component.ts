import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  ElementRef,
  ViewChild,
  input,
  output,
  effect,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import maplibregl from 'maplibre-gl';
import type { Geometry, Polygon, Position } from 'geojson';
import { BidSheetLocation } from '@models';
import { BidSheetMapRenderModel, BidSheetMapRenderGroup, FieldContextInfo, ParcelOwnerMatch } from './bid-sheet-map.model';
import {
  mergeLandMapMagicLayers,
  captureLayerOpacity,
  setLayerGroupOpacity,
  type LmmLayerIds,
  type LmmLayerOpacitySnapshot,
} from '../../../../shared/services/land-map-magic/lmm-styles.service';
import { pointLookup, type LookupField } from '../../../../shared/services/land-map-magic/lmm-point-lookup';
import { aoiQuery } from '../../../../shared/services/land-map-magic/lmm-aoi-query';
import { pickPolygonGeometry, toAoiFeature, paddedBoundingBoxPolygon, pointInPolygon } from '../../../../shared/services/land-map-magic/geo';

/**
 * BidSheetMapComponent — MapLibre GL rendering path for the Bid Sheet map.
 * See docs/poc/bid-sheet-map/03-frontend-components.md for the full design this ports from
 * `field-tag-map.component.ts` (basemap init/lifecycle pattern, CLU/Parcel vendor-layer merge,
 * click-to-inspect popup mechanics, JIT point-lookup/AOI-query call sites) and from
 * `bid-sheet.component.ts`'s existing (still-present) Leaflet path (marker rendering/camera logic).
 *
 * CLU/Parcel here is READ-ONLY reference context — no "Confirm this field" button, no persistence
 * path, and (per docs/poc/bid-sheet-map/00-overview.md settled decision 5) no AOI/point-lookup call
 * ever fires for a pin that hasn't been explicitly clicked/selected: never batch, never
 * prefetch-on-viewport/hover, never a background warm-up.
 */

// Basemap layers — all three added up-front in the initial style and switched only via
// setLayoutProperty visibility toggles (never map.setStyle(), which would wipe any later-merged
// LandMapMagic layers). Same tileset ids already proven in field-tag-map.component.ts.
const STREET_SOURCE_ID = 'bs-azure-street';
const IMAGERY_SOURCE_ID = 'bs-azure-imagery';
const HYBRID_OVERLAY_SOURCE_ID = 'bs-azure-hybrid-overlay';
const STREET_LAYER_ID = STREET_SOURCE_ID;
const IMAGERY_LAYER_ID = IMAGERY_SOURCE_ID;
const HYBRID_OVERLAY_LAYER_ID = HYBRID_OVERLAY_SOURCE_ID;
const AZURE_IMAGERY_TILESET = 'microsoft.imagery';
const AZURE_STREET_TILESET = 'microsoft.base.road';
const AZURE_HYBRID_TILESET = 'microsoft.base.hybrid.road';
type BasemapStyle = 'street' | 'imagery' | 'hybrid';

// Matches today's Leaflet default view (`setView([38.5, -98.0], 6)`) — note MapLibre is lng-first.
const DEFAULT_CENTER: [number, number] = [-98.0, 38.5];
const DEFAULT_ZOOM = 6;

// Same national-overview threshold Leaflet uses today: below this zoom, pins collapse to plain dots.
const DOT_ZOOM_THRESHOLD = 6;

// Same pixel-space decluttering constants as the Leaflet path's _spreadOverlappingPins.
const SPREAD_PX = 24;
const OVERLAP_PX = SPREAD_PX * 2;

// ~2.5s fallback so the basemap-switch loading overlay never gets stuck if 'idle' doesn't fire
// (e.g. fully cached tiles never re-emit a load event) — mirrors the Leaflet path's own fallback.
const BASEMAP_SWITCH_FALLBACK_MS = 2500;

// Debounce window for zoom-driven marker re-renders — mirrors the Leaflet path's zoomend debounce.
const ZOOM_DEBOUNCE_MS = 200;

// Zoom level after a geocoded address-search fly — matches field-tag-map.component.ts's
// SEARCH_RESULT_ZOOM (close enough to place an add-location pin precisely, not so close the
// surrounding context disappears).
const ADDRESS_SEARCH_ZOOM = 13;

// Same padding rationale as field-tag-map.component.ts's CLU_AOI_PADDING_METERS: the AOI endpoint
// only returns features that geographically intersect the submitted polygon, and a bare click point
// has zero area — pad a small box around it so the AOI query has something to intersect.
const CLU_AOI_PADDING_METERS = 400;
const JIT_LOOKUP_AOI_PADDING_METERS = 200;

// Minimum zoom at which the vendor's CLU / Parcel vector tiles actually exist and render at all —
// confirmed live against the vendor's real style response (`GET /v1/styles?...&layers=clu,parcels`):
// the `clu` source's own `minzoom` is 12, the `parcels` source's own `minzoom` is 14. Below these
// floors there is nothing to select or highlight no matter how the paint/opacity toggle is set —
// see `enforceMinZoomForTier`.
const CLU_MIN_SELECTABLE_ZOOM = 12;
const PARCELS_MIN_SELECTABLE_ZOOM = 14;

// ~1.2s fallback so a forced zoom-in for parcel-owner enrichment (see `handlePinSelectFieldContext`)
// never blocks the JIT lookup indefinitely if the map's 'idle' event doesn't fire for some reason —
// same fallback idiom as BASEMAP_SWITCH_FALLBACK_MS above.
const FIELD_CONTEXT_TILE_WAIT_FALLBACK_MS = 1200;

// Vertical gap (px) between a selected pin's own marker box and the field-context popup shown
// above it — see `showInfoPopup`'s `positionAboveMarker` option. A rough upper bound on this
// component's marker box heights (`buildHoverHtml`/`buildStackedLabelHtml`/`buildBidPillsHtml`,
// each roughly 35-70px tall including their own pointer triangle), not a per-marker exact
// measurement — good enough to reliably clear the marker without leaving excess dead space.
const FIELD_CONTEXT_POPUP_OFFSET_PX = 56;

interface RenderedMarker {
  marker: maplibregl.Marker;
  el: HTMLElement;
  originalHtml: string;
  hoverHtml: string;
}

@Component({
  selector: 'app-bid-sheet-map',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './bid-sheet-map.component.html',
})
export class BidSheetMapComponent {
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('mapContainer', { static: true }) private mapContainerRef!: ElementRef<HTMLDivElement>;

  // ── Inputs (parent-owned, unchanged models — see bid-sheet.model.ts) ────────────────────────
  readonly locations = input.required<BidSheetLocation[]>();
  readonly renderModel = input.required<BidSheetMapRenderModel>();
  readonly addLocationMode = input<boolean>(false);
  readonly panelWidthPx = input<number>(0);

  /** Camera commands — nonce'd so a repeat command (e.g. clicking the same pin twice) still re-fires. */
  readonly flyTo = input<{ lat: number; lng: number; zoom?: number; nonce: number } | null>(null);
  readonly fitAll = input<{ nonce: number } | null>(null);
  /**
   * Geocoded address-search "fly" command — mirrors `flyTo`'s nonce pattern (a repeat search for the
   * identical address must still re-fire, which plain signal equality on identical coordinates would
   * otherwise swallow) and, more directly, `flyToLocation` on `field-tag-map.component.ts`. Driven by
   * the parent's `onAddressSearch()` handler (customer-fields.component.ts's pattern), which resolves
   * the query via `ApiService.geocodeSearch()` before setting this.
   */
  readonly flyToLocation = input<{ lat: number; lng: number; nonce: number } | null>(null);
  /** True while the parent's address-search geocode call is in flight — drives the search button's spinner. */
  readonly searchPending = input<boolean>(false);
  /**
   * JIT field-context lookup command for the pin-select trigger — nonce'd, mirrors `flyTo`. Fired by
   * the PARENT (never computed in here) because the parent owns `selectedLocationName` and is the
   * only place that can tell a click that *newly selects* a pin apart from one that deselects it or
   * repeat-clicks an already-selected pin (see `03-frontend-components.md`'s two-trigger JIT design
   * and the fix for the "over-fires on deselect/repeat click" bug). This component still gates the
   * actual lookup on its own `showFieldContext` toggle, since that state lives here, not the parent.
   */
  readonly fieldContextLookupCmd = input<{ lat: number; lng: number; nonce: number } | null>(null);

  readonly azureMapsKey = input.required<string>();
  /** Vendor config — null hides the CLU/Parcel toggle entirely (see 00-overview.md decision 7). */
  readonly landMapMagicKey = input<string | null>(null);
  readonly cdlYear = input<string | null>(null);
  readonly cdlFallbackYear = input<string | null>(null);

  // ── Outputs ───────────────────────────────────────────────────────────────
  readonly locationSelected = output<BidSheetLocation>();
  readonly mapClicked = output<{ lat: number; lng: number }>();
  readonly zoomChanged = output<number>();
  /** JIT field-context lookup result — fired only from an explicit pin-drop or pin-selection, never
   *  from hover/render/viewport. `null` means the lookup completed but found neither a CLU nor a
   *  parcel field at that point (not a failure). See `runFieldContextLookup`. */
  readonly fieldContextResolved = output<FieldContextInfo | null>();
  /**
   * Fired once per actual click-to-inspect vendor round trip (the CLU/Parcel view toggle's
   * click-on-polygon popup — `showReadOnlyFieldPopup`), so the parent can track that vendor usage
   * too. Deliberately a SEPARATE, lightweight output from `fieldContextResolved` rather than routed
   * through it: `fieldContextResolved` also drives the Add Location form's "Field context" section
   * state (`fieldContextInfo`/`fieldContextLoading` in the parent) — reusing it here would overwrite
   * that unrelated form state every time the user merely clicks a parcel to inspect it while
   * browsing, whether or not Add Location is even open. Tracked by the parent under a sibling usage
   * label, `'field-context-inspect'`, distinct from the JIT flow's `'field-context-lookup'` — see
   * `onFieldInspectPerformed` in `bid-sheet.component.ts`.
   */
  readonly fieldInspectPerformed = output<void>();
  /**
   * Geocoded address-search box submit — additive to the parent's pin-name filter search (which
   * keeps filtering visible bid-location pins by name, unchanged). The parent resolves this query
   * via `ApiService.geocodeSearch()` and feeds the result back through `flyToLocation` above,
   * mirroring `customer-fields.component.ts`'s `onAddressSearch()`.
   */
  readonly addressSearch = output<string>();

  // ── Template-facing state (basemap toggle / loading overlay) ────────────
  readonly basemapStyle = signal<BasemapStyle>('street'); // street-first default, matching Leaflet
  readonly switching = signal(false);
  /** CLU/Parcel optional view toggle — off by default, hidden entirely when landMapMagicKey() is null. */
  readonly showFieldContext = signal<'off' | 'clu' | 'parcel'>('off');
  /** Geocoded address-search input box text (template-bound). */
  readonly addressSearchText = signal('');

  private map: maplibregl.Map | null = null;
  private readonly loaded = signal(false);
  private resizeObserver: ResizeObserver | null = null;
  private renderedMarkers: RenderedMarker[] = [];
  private addLocationMarker: maplibregl.Marker | null = null;
  private hoveredMarker: RenderedMarker | null = null;
  private zoomDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ── CLU/Parcel vendor-layer state ────────────────────────────────────────
  private lmmLayers: LmmLayerIds = { clu: [], parcels: [], cluFill: [], parcelFill: [] };
  /** Captured "fully on" paint-opacity values for the CLU/parcels real vendor layers — see
   *  `setLayerGroupOpacity`'s doc comment for why tier prominence is driven by paint opacity here
   *  instead of `layout.visibility` (keeping both sources' tiles loading regardless of which tier,
   *  or neither, is visually toggled on — required for `findOverlappingParcels` to work at all
   *  while the CLU tier is active, and for owner enrichment to work even with the toggle off). */
  private cluOpacity: LmmLayerOpacitySnapshot[] = [];
  private parcelOpacity: LmmLayerOpacitySnapshot[] = [];
  /** Guard flag: the vendor style is merged at most once per component lifetime — either on first
   *  toggle-to-on, OR on the first JIT field-context lookup (pin-drop/pin-select), whichever comes
   *  first (see `runFieldContextLookup` and `ensureVendorLayers`). A session that never touches the
   *  toggle AND never clicks/drops a pin still costs zero vendor tokens/network calls; otherwise the
   *  first such interaction now costs one vendor style-merge fetch even if the CLU/Parcel UI itself
   *  is never opened — a deliberate cost-model shift from the original "toggle-gated only" design,
   *  needed so parcel-owner enrichment is available on every pin click regardless of tier/toggle
   *  state (see 03-frontend-components.md and the fix for "owner data missing while CLU active"). */
  private vendorLayersMerged = false;
  private activePopup: maplibregl.Popup | null = null;
  /** The popup shown by `showFieldContextPinPopup` on a bid-sheet pin SELECT (distinct from
   *  `activePopup`, which is the CLU/Parcel click-to-inspect popup — the two can never coexist in
   *  practice today, but keeping them separate avoids one flow's close accidentally clobbering the
   *  other's popup reference). */
  private fieldContextPopup: maplibregl.Popup | null = null;
  /** The CLU/parcel feature currently highlighted (feature-state `selected: true`) by
   *  `showFieldContextPinPopup`, so `clearFieldContextHighlight` can turn it back off — either when
   *  a new pin is selected, the popup is closed, or the CLU/Parcel toggle changes tier. */
  private selectedFieldHighlight: { source: string; sourceLayer: string; id: string | number } | null = null;

  constructor() {
    afterNextRender(() => this.initMap());
    this.destroyRef.onDestroy(() => {
      if (this.zoomDebounceTimer) clearTimeout(this.zoomDebounceTimer);
      this.resizeObserver?.disconnect();
      this.activePopup?.remove();
      this.fieldContextPopup?.remove();
      this.map?.remove();
    });

    // renderModel -> redraw. Covers both data changes (filters/status) and zoom-driven pinKind
    // changes (the parent recomputes renderModel whenever mapZoom changes via our zoomChanged
    // output) uniformly — same trigger surface the Leaflet path's zoomend->_refreshMapMarkers has.
    effect(() => {
      const rm = this.renderModel();
      if (!this.loaded()) return;
      this.redrawMarkers(rm);
    });

    // addLocationMode -> clear the add-location "+" pin when leaving the mode (the form's Cancel/
    // Done both flow through the parent's exitAddLocationMode(), which this mirrors on our side).
    // Entering the mode WHILE a CLU/Parcel tier is already active also enforces that tier's minimum
    // selectable zoom (see `enforceMinZoomForTier`) — dropping a new pin needs to actually be able to
    // see/select the CLU or parcel shape it's about to attach to.
    effect(() => {
      const mode = this.addLocationMode();
      if (!this.loaded()) return;
      if (!mode) {
        this.addLocationMarker?.remove();
        this.addLocationMarker = null;
        return;
      }
      const tier = this.showFieldContext();
      if (tier !== 'off') this.enforceMinZoomForTier(tier);
    });

    // flyTo (selection/search -> camera), mirroring field-tag-map.component.ts's flyToTagId pattern.
    effect(() => {
      const cmd = this.flyTo();
      if (!this.loaded() || cmd == null || !this.map) return;
      const targetZoom = cmd.zoom ?? Math.max(this.map.getZoom(), 11);
      this.map.flyTo({
        center: [cmd.lng, cmd.lat],
        zoom: targetZoom,
        duration: 600,
        padding: { top: 0, bottom: 0, left: 0, right: this.panelWidthPx() },
      });
    });

    // fitAll -> fitBounds over every currently-rendered group, panel-aware padding replacing the
    // Leaflet path's manual _offsetCenter project/unproject math.
    effect(() => {
      const cmd = this.fitAll();
      if (!this.loaded() || cmd == null) return;
      this.fitToVisibleGroups();
    });

    // flyToLocation (address search -> camera) -> flyTo. Mirrors field-tag-map.component.ts's
    // identically-named effect; panel-aware padding matches the `flyTo` effect above.
    effect(() => {
      const loc = this.flyToLocation();
      if (!this.loaded() || loc == null || !this.map) return;
      this.map.flyTo({
        center: [loc.lng, loc.lat],
        zoom: ADDRESS_SEARCH_ZOOM,
        duration: 600,
        padding: { top: 0, bottom: 0, left: 0, right: this.panelWidthPx() },
      });
    });

    // fieldContextLookupCmd (pin-select JIT trigger, commanded by the parent) -> runFieldContextLookup.
    // The parent only sets this when a click actually transitions a pin TO selected (never on
    // deselection or a repeat click on an already-selected pin — see 03-frontend-components.md and
    // the fix for the "over-fires on deselect/repeat click" bug). Fires unconditionally regardless
    // of the CLU/Parcel toggle state — this used to gate on `showFieldContext() !== 'off'`, but the
    // JIT lookup (acreage/crop/owner enrichment for the Add Location form) is independent product
    // data from the read-only CLU/Parcel map overlay: a pin click should always attempt it, exactly
    // like the pin-DROP trigger below already does unconditionally (see `initMap`'s map click
    // handler). `untracked` is no longer needed here since the toggle is no longer read at all.
    effect(() => {
      const cmd = this.fieldContextLookupCmd();
      if (cmd == null) return;
      void this.handlePinSelectFieldContext(cmd.lat, cmd.lng);
    });
  }

  /** Address-search submit handler (template-bound) — mirrors field-tag-map.component.ts's
   *  `emitAddressSearch()`. Purely emits the raw query text; the parent owns the geocode call. */
  emitAddressSearch(): void {
    const q = this.addressSearchText().trim();
    if (q) this.addressSearch.emit(q);
  }

  /** Basemap toggle (template-bound). Visibility-only — never map.setStyle(). */
  setBasemap(style: BasemapStyle): void {
    const map = this.map;
    if (!map || !map.getLayer(STREET_LAYER_ID) || this.switching()) return;
    if (style === this.basemapStyle()) return;

    this.basemapStyle.set(style);
    this.switching.set(true);

    map.setLayoutProperty(STREET_LAYER_ID, 'visibility', style === 'street' ? 'visible' : 'none');
    map.setLayoutProperty(IMAGERY_LAYER_ID, 'visibility', style === 'street' ? 'none' : 'visible');
    map.setLayoutProperty(HYBRID_OVERLAY_LAYER_ID, 'visibility', style === 'hybrid' ? 'visible' : 'none');

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      this.switching.set(false);
    };
    map.once('idle', finish);
    setTimeout(finish, BASEMAP_SWITCH_FALLBACK_MS);
  }

  // ── CLU/Parcel optional view toggle (template-bound) ─────────────────────

  /**
   * Two-button toggle (CLU / Parcel) — clicking the currently-active tier turns the view back off,
   * matching "two buttons only, no draw tier" from 03-frontend-components.md. Hidden entirely in
   * the template when `landMapMagicKey()` is null.
   */
  toggleFieldContext(mode: 'clu' | 'parcel'): void {
    const next = this.showFieldContext() === mode ? 'off' : mode;
    this.showFieldContext.set(next);
    this.activePopup?.remove();
    this.activePopup = null;
    // A pin-select popup/highlight from BEFORE this toggle change reflects the OLD tier rule (CLU
    // vs. parcel) — close it rather than leave a highlight on-screen that no longer matches what
    // the acreage-source rule would now pick for that same point.
    this.fieldContextPopup?.remove();
    this.fieldContextPopup = null;
    this.clearFieldContextHighlight();

    const map = this.map;
    if (!map || !this.loaded()) return;

    if (next === 'off') {
      setLayerGroupOpacity(map, this.cluOpacity, false);
      setLayerGroupOpacity(map, this.parcelOpacity, false);
      return;
    }

    // Turning a tier ON: zoom IN (never out) to that tier's minimum selectable zoom, but only when
    // no bid-sheet pin is currently selected — a selected pin already owns the camera via its own
    // `flyTo` command (00-overview.md's existing camera-ownership split), so this only kicks in for
    // plain browsing / about-to-add-a-location. See `enforceMinZoomForTier`.
    this.enforceMinZoomForTier(next);

    void this.ensureVendorLayers().then(() => {
      setLayerGroupOpacity(map, this.cluOpacity, this.showFieldContext() === 'clu');
      setLayerGroupOpacity(map, this.parcelOpacity, this.showFieldContext() === 'parcel');
    });
  }

  /**
   * Zooms IN (never out) to the minimum zoom at which the given tier's CLU/parcel shapes actually
   * exist and render — see `CLU_MIN_SELECTABLE_ZOOM`/`PARCELS_MIN_SELECTABLE_ZOOM`. No-ops if the
   * map is already at or above that floor (leaves the user's own zoom alone), and no-ops if a
   * bid-sheet pin is currently selected (checked via `renderModel().groups[].isPanelOpen` — the
   * same "is a location open in the detail panel" flag the render model already carries) since a
   * selected pin's own camera command already takes precedence over this general "make shapes
   * selectable while browsing" behavior.
   */
  private enforceMinZoomForTier(tier: 'clu' | 'parcel'): void {
    const map = this.map;
    if (!map) return;
    const minZoom = tier === 'clu' ? CLU_MIN_SELECTABLE_ZOOM : PARCELS_MIN_SELECTABLE_ZOOM;
    if (map.getZoom() >= minZoom) return;
    if (this.renderModel().groups.some((g) => g.isPanelOpen)) return;
    map.easeTo({ zoom: minZoom, duration: 400 });
  }

  /**
   * Fetch + merge the LandMapMagic vendor style exactly once per component lifetime, on first
   * toggle-to-on. Never called from init/effects — only from `toggleFieldContext` above — so a
   * session that never touches the toggle never fetches vendor styles/tiles at all.
   */
  private async ensureVendorLayers(): Promise<void> {
    const map = this.map;
    if (!map || this.vendorLayersMerged) return;
    const key = this.landMapMagicKey();
    if (!key) return;
    try {
      // Never map.setStyle() — that would wipe the Azure imagery base and every rendered marker.
      this.lmmLayers = await mergeLandMapMagicLayers(map, key);
      this.vendorLayersMerged = true;
      // Layout visibility for every merged layer stays 'visible' PERMANENTLY from here on — it is
      // never toggled again for either group. Tier prominence (which tier looks "on") is driven
      // entirely by paint opacity below (`setLayerGroupOpacity`), which has no effect on whether
      // MapLibre keeps fetching that source's vector tiles — see `setLayerGroupOpacity`'s doc
      // comment in lmm-styles.service.ts for the full rationale.
      this.cluOpacity = captureLayerOpacity(map, this.lmmLayers.clu);
      this.parcelOpacity = captureLayerOpacity(map, this.lmmLayers.parcels);
      setLayerGroupOpacity(map, this.cluOpacity, false);
      setLayerGroupOpacity(map, this.parcelOpacity, false);
      this.wireVendorLayerInteractions(this.lmmLayers.cluFill, 'clu');
      this.wireVendorLayerInteractions(this.lmmLayers.parcelFill, 'parcel');
    } catch (err) {
      console.error('[bid-sheet-map] Failed to load LandMapMagic layers:', err);
    }
  }

  /**
   * Click-to-inspect wiring — read-only info popup, no confirm button, no persistence path. Ported
   * from field-tag-map.component.ts's `wireVendorLayerInteractions`, minus the confirm/select
   * feature-state bookkeeping this component has no use for.
   */
  private wireVendorLayerInteractions(fillLayerIds: string[], method: 'clu' | 'parcel'): void {
    const map = this.map;
    if (!map) return;
    for (const layerId of fillLayerIds) {
      map.on('mousemove', layerId, () => {
        if (this.showFieldContext() !== method) return;
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layerId, () => {
        if (this.showFieldContext() !== method) return;
        map.getCanvas().style.cursor = '';
      });
      map.on('click', layerId, (e) => {
        if (this.showFieldContext() !== method) return;
        // Add-location mode owns this click instead (see the map-wide handler in `initMap()`) —
        // its own JIT lookup already covers the point, so skip click-to-inspect entirely here to
        // avoid firing both paths (and both vendor round trips) for one physical click.
        if (this.addLocationMode()) return;
        void this.showReadOnlyFieldPopup(e, method);
      });
    }
  }

  /**
   * Read-only click-to-inspect popup — one point-lookup + one AOI query per click (the same "one
   * explicit action, one round trip" rule as the JIT lookup below), rendering acreage/county/state/
   * top-crop/owner info with no "Confirm this field" affordance and no emit.
   */
  private async showReadOnlyFieldPopup(
    e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
    method: 'clu' | 'parcel',
  ): Promise<void> {
    const tileFeature = e.features?.[0];
    if (!tileFeature) return;
    const key = this.landMapMagicKey();
    if (!key) return;

    // Every click past this point performs at least one vendor call (pointLookup below, and
    // usually a follow-on AOI query) — emit once per click so the parent can track this vendor usage
    // too (see `fieldInspectPerformed`'s doc comment for why this is a separate output/action label
    // from the pin-drop/pin-select JIT flow's `fieldContextResolved`/`'field-context-lookup'`).
    this.fieldInspectPerformed.emit();

    this.activePopup?.remove();
    this.activePopup = this.showLoadingPopup(e.lngLat);

    const tileProps = (tileFeature.properties ?? {}) as Record<string, unknown>;
    const lookupLayer = method === 'clu' ? 'clu' : 'parcels';

    let lookupField: LookupField | undefined;
    try {
      const results = await pointLookup(e.lngLat.lat, e.lngLat.lng, key);
      lookupField = results.find((f) => f.layer === lookupLayer) ?? results[0];
    } catch (err) {
      console.warn('[bid-sheet-map] Point Lookup failed; falling back to tile feature properties.', err);
    }

    const acreage =
      lookupField?.acreage ?? this.toNumber(lookupLayer === 'parcels' ? tileProps['acreage_calc'] : tileProps['calcacres']);
    // Clicking a PARCEL shape directly already has the owner right on the clicked tile feature's own
    // properties. Clicking a CLU shape does NOT (CLU tiles carry no owner property at all — that's
    // cadastral/parcel data, a different dataset) — this used to just show `null` there, unconditionally,
    // regardless of anything else, even though a parcel (with an owner) usually exists at that same
    // point. Fall back to the same client-side parcels geometry match `findOverlappingParcels` already
    // uses for the pin-select JIT lookup, so clicking a CLU shape surfaces the underlying parcel's
    // owner too instead of always showing nothing.
    const owner =
      method === 'parcel'
        ? this.toDisplayString(tileProps['owner'])
        : (this.findOverlappingParcels(e.lngLat.lat, e.lngLat.lng)[0]?.owner ?? null);

    const sourceGeometry =
      pickPolygonGeometry(lookupField?.feature.geometry as Geometry | undefined) ??
      pickPolygonGeometry(tileFeature.geometry as Geometry);

    const cdlYear = this.cdlYear();
    const cdlFallbackYear = this.cdlFallbackYear();

    if (!sourceGeometry || !cdlYear || !cdlFallbackYear) {
      this.activePopup?.remove();
      this.activePopup = this.showInfoPopup(e.lngLat, { acreage, county: null, state: null, topCrop: null, owner });
      return;
    }

    try {
      const aoiGeometry = method === 'clu' ? paddedBoundingBoxPolygon(sourceGeometry, CLU_AOI_PADDING_METERS) : sourceGeometry;
      const result = await aoiQuery(toAoiFeature(aoiGeometry), method === 'clu', key, cdlYear, cdlFallbackYear);
      const topCrop = this.topCrop(result.cropBreakdown);
      this.activePopup?.remove();
      this.activePopup = this.showInfoPopup(e.lngLat, {
        acreage,
        county: result.county,
        state: result.state,
        topCrop: topCrop?.name ?? null,
        owner,
      });
    } catch (err) {
      console.error('[bid-sheet-map] AOI Query failed:', err);
      this.activePopup?.remove();
      this.activePopup = this.showInfoPopup(e.lngLat, { acreage, county: null, state: null, topCrop: null, owner, error: true });
    }
  }

  // ── JIT field-context lookup (pin-drop / pin-select — explicit action only) ─────────────────
  //
  // Hard constraint (00-overview.md decision 5): exactly one point-lookup + one AOI query per one
  // explicit user action, targeting exactly one point. Called from exactly two call sites in this
  // file — the add-location click handler in `initMap()`, and the existing-pin click handler in
  // `addMarker()` — never from hover, never from a render/redraw loop, never in bulk.

  /**
   * Fires the JIT lookup for one point. Emits `fieldContextResolved` exactly once per call, whether
   * the lookup succeeds, finds nothing, or fails outright (a failed round trip still "fired" for
   * usage-tracking purposes — see the parent's `onFieldContextResolved`). No-ops entirely (no emit
   * at all) when `landMapMagicKey` isn't configured, so no vendor call is even attempted.
   *
   * Also RETURNS the built `info` and the raw `pointLookup` results — the pin-SELECT call site
   * (`handlePinSelectFieldContext` below) needs the raw per-layer results too, since the on-map
   * popup/highlight it shows picks CLU vs. parcel by the CURRENT CLU/Parcel toggle tier, which can
   * differ from `method` here (this function's `method` always prefers CLU when both exist,
   * independent of the toggle — that's the Add Location form's existing, unchanged behavior).
   */
  private async runFieldContextLookup(
    lat: number,
    lng: number,
  ): Promise<{ info: FieldContextInfo | null; lookupResults: LookupField[] }> {
    const key = this.landMapMagicKey();
    if (!key) return { info: null, lookupResults: [] };

    // Lazily merge the vendor style/sources on the very FIRST JIT lookup of the session, even if
    // the CLU/Parcel toggle has never been touched at all — parcel-owner enrichment below
    // (`findOverlappingParcels`) needs the 'parcels' vector source to exist and be actively
    // fetching tiles, which requires this merge to have happened. `ensureVendorLayers` still
    // guards on `vendorLayersMerged` so this is a no-op after the first call (from either this
    // lookup or the CLU/Parcel toggle, whichever fires first) — see that guard's doc comment for
    // the resulting cost-model shift (a pin click now COSTS one vendor style-merge fetch even with
    // the toggle UI never opened, which is intentional per the "owner data regardless of tier or
    // toggle state" fix).
    await this.ensureVendorLayers();

    // Parcel-owner enrichment (`findOverlappingParcels`, called near the end of every branch below)
    // needs the 'parcels' source's tiles for THIS point to have actually FINISHED loading — and that
    // can still be pending even at an already-sufficient zoom: MapLibre prioritizes fetching tiles
    // for whatever's actually being PAINTED, so while CLU is the tier currently rendered (non-zero
    // paint opacity), the invisible (opacity-0) 'parcels' tiles for the same area can end up queued
    // behind CLU's own tile requests, taking longer to arrive — this is exactly why owner data was
    // reliably missing while CLU was the active tier but present while Parcel was active, at the
    // IDENTICAL point and zoom (parcels tiles get that same fetch priority when Parcel is the tier
    // actually being rendered). Kick off an idle-wait now, run it CONCURRENTLY with the point-lookup/
    // AOI network round trips below (so it doesn't add latency on top of them), and only actually
    // await it right before each branch's owner-enrichment step needs it.
    const tilesReady = this.waitForMapIdle();

    let method: 'clu' | 'parcel' | null = null;
    let acreage: number | null = null;
    let lookupResults: LookupField[] = [];
    try {
      lookupResults = await pointLookup(lat, lng, key);
      const lookupField = lookupResults.find((f) => f.layer === 'clu') ?? lookupResults.find((f) => f.layer === 'parcels') ?? null;
      if (lookupField) {
        method = lookupField.layer === 'clu' ? 'clu' : 'parcel';
        acreage = lookupField.acreage;
      }
    } catch (err) {
      console.warn('[bid-sheet-map] Point Lookup failed for field-context lookup:', err);
    }

    const cdlYear = this.cdlYear();
    const cdlFallbackYear = this.cdlFallbackYear();
    if (!cdlYear || !cdlFallbackYear) {
      // Parcel-owner enrichment is independent of the CDL-year config the AOI query needs below —
      // don't drop it here too (it previously silently went missing whenever cdlYear/cdlFallbackYear
      // weren't configured at all, same class of bug as the AOI-failure branch below).
      await tilesReady;
      const parcels = this.findOverlappingParcels(lat, lng);
      const info = this.buildFieldContextResult(method, acreage, null, null, null, parcels);
      this.fieldContextResolved.emit(info);
      return { info, lookupResults };
    }

    try {
      // A bare click point has zero area, so pad a small box around it — the AOI endpoint only
      // returns features that geographically intersect the submitted polygon (same rationale as
      // field-tag-map.component.ts's CLU_AOI_PADDING_METERS, applied here regardless of method
      // since there's no real clicked-feature geometry to submit instead).
      const pointPolygon: Polygon = { type: 'Polygon', coordinates: [[[lng, lat], [lng, lat], [lng, lat], [lng, lat]]] };
      const aoiGeometry = paddedBoundingBoxPolygon(pointPolygon, JIT_LOOKUP_AOI_PADDING_METERS);
      const result = await aoiQuery(toAoiFeature(aoiGeometry), method === 'clu', key, cdlYear, cdlFallbackYear);
      const topCrop = this.topCrop(result.cropBreakdown);
      await tilesReady;
      const parcels = this.findOverlappingParcels(lat, lng);
      const info = this.buildFieldContextResult(method, acreage, result.county, result.state, topCrop?.name ?? null, parcels);
      this.fieldContextResolved.emit(info);
      return { info, lookupResults };
    } catch (err) {
      console.error('[bid-sheet-map] AOI Query failed for field-context lookup:', err);
      // Parcel-owner enrichment doesn't depend on the AOI query that just failed — still attempt it
      // rather than silently dropping it (same rationale as the cdlYear-missing branch above).
      await tilesReady;
      const parcels = this.findOverlappingParcels(lat, lng);
      const info = this.buildFieldContextResult(method, acreage, null, null, null, parcels);
      this.fieldContextResolved.emit(info);
      return { info, lookupResults };
    }
  }

  /**
   * Pin-SELECT-only wrapper (never called for pin-drop) around `runFieldContextLookup` that ALSO
   * shows an on-map popup + highlights the matching CLU/parcel shape, so the user can see WHERE the
   * displayed acreage came from — see `showFieldContextPinPopup` for the tier rule (CLU is the
   * default whenever the toggle is off or set to 'clu'; only an explicit Parcel tier switches both
   * the acreage figure and the highlight to the parcel).
   */
  private async handlePinSelectFieldContext(lat: number, lng: number): Promise<void> {
    if (!this.landMapMagicKey()) return;
    // Owner enrichment (`findOverlappingParcels`, called unconditionally inside
    // `runFieldContextLookup` regardless of tier) needs the 'parcels' vector SOURCE's tiles to
    // actually be loaded for this point — that source has a hard minzoom floor of 14 (confirmed
    // live against the vendor's real style response), below which MapLibre will never even REQUEST
    // parcel tiles, no matter which tier (or none) is currently toggled on. Bump zoom in (never out)
    // to the SAME target center this selection is already flying to, so it supersedes rather than
    // fights the parent's simultaneous `flyTo` command for this same selection (see that effect
    // above) — both target the identical destination, just a possibly-higher zoom. This only
    // guarantees the zoom FLOOR is met — `runFieldContextLookup`'s own `tilesReady` wait (below)
    // separately guarantees the tiles have actually finished loading by the time they're needed,
    // which the zoom floor alone does NOT (see that wait's doc comment for why this even matters at
    // an ALREADY-sufficient zoom).
    const map = this.map;
    if (map && map.getZoom() < PARCELS_MIN_SELECTABLE_ZOOM) {
      map.easeTo({ center: [lng, lat], zoom: PARCELS_MIN_SELECTABLE_ZOOM, duration: 400 });
    }
    const { info, lookupResults } = await this.runFieldContextLookup(lat, lng);
    this.showFieldContextPinPopup(lat, lng, info, lookupResults);
  }

  /** Resolves once the map has no outstanding tile/source work ('idle'), or after a fallback
   *  timeout — see `FIELD_CONTEXT_TILE_WAIT_FALLBACK_MS`'s doc comment. Used by
   *  `runFieldContextLookup` to give the 'parcels' source's tiles a real chance to finish loading
   *  before the owner-enrichment step (`findOverlappingParcels`) needs them, rather than guessing a
   *  fixed delay — see that call site's doc comment for why this matters even at an
   *  already-sufficient zoom. */
  private waitForMapIdle(): Promise<void> {
    const map = this.map;
    if (!map) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      map.once('idle', finish);
      setTimeout(finish, FIELD_CONTEXT_TILE_WAIT_FALLBACK_MS);
    });
  }

  /**
   * Shows a read-only info popup (acreage/county/state/top-crop/owner) at a SELECTED bid-sheet
   * pin's coordinates, and highlights the CLU or parcel shape the acreage came from via the same
   * feature-state `selected` mechanism `wireVendorLayerInteractions`'s click-to-inspect flow uses
   * (`CLU_SELECTED_LAYER_ID`/`PARCELS_SELECTED_LAYER_ID` in lmm-styles.service.ts — both layers stay
   * `layout.visibility: 'visible'` and paint their outline purely off this feature-state, so the
   * highlight renders regardless of which tier's PAINT opacity is currently toggled on/off).
   *
   * Tier rule (product decision): CLU is the DEFAULT acreage/highlight source whenever the
   * CLU/Parcel toggle is off OR explicitly set to 'clu'. Only an explicit Parcel tier selection
   * switches both the acreage figure and the highlighted shape to the parcel. No popup/highlight at
   * all if the requested tier's layer has no result at this point (nothing to show or highlight).
   *
   * CLU and Parcel data come from DIFFERENT sources here, and that's deliberate, not an oversight:
   * confirmed LIVE against the real vendor API (`GET /v1/data/point?...`) that its response's
   * `layers` object NEVER contains a `parcels` key at all — only `clu` — for any coordinate, at any
   * zoom (matches `lmm-point-lookup.ts`'s own long-standing doc comment on `pointLookup`, which this
   * verified is still accurate today). Sourcing parcel acreage/identity from `lookupResults` (as an
   * earlier version of this method did) therefore ALWAYS failed for the parcel tier, unconditionally
   * — not a zoom or tile-loading issue. Parcel data instead comes from `info.parcels[0]`
   * (`findOverlappingParcels`'s client-side geometry match, already computed unconditionally inside
   * `runFieldContextLookup`), which conveniently already carries the exact matched feature `id` too
   * — no need to separately re-query/re-match geometry for the highlight in that case.
   *
   * CLU/off tier ALSO falls back to the parcel match when NO CLU field exists at the clicked point
   * at all — a common case: CLU only covers agricultural common land units, while cadastral parcel
   * data covers essentially all land, so a "random" point is far more likely to fall within some
   * parcel than within a specific CLU field. Without this fallback, a point with no CLU coverage but
   * a real parcel/owner underneath it showed NOTHING (the CLU branch's own "no CLU here" check
   * returned before ever reaching the owner data) — silently dropping owner info that was sitting
   * right there in `info.parcels`, which is exactly the kind of gap this feature exists to close.
   */
  private showFieldContextPinPopup(
    lat: number,
    lng: number,
    info: FieldContextInfo | null,
    lookupResults: LookupField[],
  ): void {
    const map = this.map;
    if (!map) return;

    this.clearFieldContextHighlight();
    this.fieldContextPopup?.remove();
    this.fieldContextPopup = null;

    const tier: 'clu' | 'parcel' = this.showFieldContext() === 'parcel' ? 'parcel' : 'clu';

    let acreage: number | null = null;
    let featureId: string | number | null = null;
    let source: 'clu' | 'parcels' = 'clu';
    let title: string;

    const cluLookupField = tier === 'clu' ? lookupResults.find((f) => f.layer === 'clu') ?? null : null;

    if (tier === 'clu' && cluLookupField) {
      acreage = cluLookupField.acreage;
      source = 'clu';
      title = 'CLU Field';

      // Deliberately a GEOGRAPHIC point-in-polygon match against already-loaded SOURCE features
      // (`querySourceFeatures` + `pointInPolygon`), the exact technique `findOverlappingParcels`
      // already uses for parcels — NOT a pixel-based `queryRenderedFeatures` at the single screen
      // pixel the pin projects to (an earlier version of this method used that and it was
      // precision-sensitive/unreliable, particularly for smaller shapes). Testing the real polygon
      // geometry directly in lat/lng space sidesteps screen-pixel and tile-clipping precision
      // entirely. Confirmed live against the vendor's actual style (`GET /v1/styles?...`): CLU's
      // `source-layer` equals its source id ('clu'), so `source` doubles as the sourceLayer name
      // here, same as `findOverlappingParcels` does for 'parcels'.
      if (map.getSource(source)) {
        const point: Position = [lng, lat];
        const fragments = map.querySourceFeatures(source, { sourceLayer: source });
        for (const f of fragments) {
          if (f.id == null) continue;
          const geom = pickPolygonGeometry(f.geometry as Geometry);
          if (geom && pointInPolygon(point, geom)) {
            featureId = f.id;
            break;
          }
        }
      }
    } else {
      // Either the tier is explicitly 'parcel', OR it's CLU/off but no CLU field exists at this
      // point — either way, fall back to the parcel match. `source`/`title` reflect whichever data
      // actually ends up used, NOT the raw toggle state, so the highlight always targets the right
      // source.
      const match = info?.parcels[0] ?? null;
      if (!match) return;
      acreage = match.acreage;
      featureId = match.id;
      source = 'parcels';
      title = 'Parcel';
    }

    if (featureId != null) {
      map.setFeatureState({ source, sourceLayer: source, id: featureId }, { selected: true });
      this.selectedFieldHighlight = { source, sourceLayer: source, id: featureId };
    }

    const owner = info?.parcels[0]?.owner ?? null;
    const popup = this.showInfoPopup(
      [lng, lat],
      {
        acreage,
        county: info?.county ?? null,
        state: info?.state ?? null,
        topCrop: info?.topCrop ?? null,
        owner,
        title,
      },
      { positionAboveMarker: true },
    );
    // The popup's own "x" close button (and clicking elsewhere on the map, MapLibre's default
    // closeOnClick behavior) both fire this 'close' event — either way, the highlight should not
    // outlive the popup that explains it.
    popup.on('close', () => this.clearFieldContextHighlight());
    this.fieldContextPopup = popup;
  }

  /** Clears whichever CLU/parcel feature-state highlight `showFieldContextPinPopup` last set, if any. */
  private clearFieldContextHighlight(): void {
    const highlight = this.selectedFieldHighlight;
    this.selectedFieldHighlight = null;
    if (!highlight || !this.map) return;
    if (this.map.getSource(highlight.source)) {
      this.map.setFeatureState({ source: highlight.source, sourceLayer: highlight.sourceLayer, id: highlight.id }, { selected: false });
    }
  }

  private buildFieldContextResult(
    method: 'clu' | 'parcel' | null,
    acreage: number | null,
    county: string | null,
    state: string | null,
    topCrop: string | null,
    parcels: ParcelOwnerMatch[] = [],
  ): FieldContextInfo | null {
    if (method == null && acreage == null && county == null && state == null && topCrop == null && parcels.length === 0) {
      return null;
    }
    return { method, acreage, county, state, topCrop, parcels };
  }

  /**
   * Client-side spatial match against whatever "parcels" MVT tiles are already loaded (the vendor
   * API has no owner-lookup endpoint — see field-tag-map.component.ts's `findOverlappingParcels`
   * for the full rationale). Returns `[]` if the parcels source was never merged (e.g. the toggle
   * has never been switched on this session) — this is a best-effort enrichment, not a blocking
   * requirement of the JIT lookup.
   */
  private findOverlappingParcels(lat: number, lng: number): ParcelOwnerMatch[] {
    const map = this.map;
    if (!map || !map.getSource('parcels')) return [];
    const point: Position = [lng, lat];
    const fragments = map.querySourceFeatures('parcels', { sourceLayer: 'parcels' });
    const seen = new Set<string | number>();
    const matches: ParcelOwnerMatch[] = [];
    for (const f of fragments) {
      if (f.id == null || seen.has(f.id)) continue;
      const geom = pickPolygonGeometry(f.geometry as Geometry);
      if (!geom || !pointInPolygon(point, geom)) continue;
      seen.add(f.id);
      const props = (f.properties ?? {}) as Record<string, unknown>;
      matches.push({
        id: f.id,
        parcelId: String(f.id),
        owner: this.toDisplayString(props['owner']),
        acreage: this.toNumber(props['acreage_calc']),
      });
    }
    return matches;
  }

  // ── Read-only popups (see field-tag-map.component.ts's popup module comment for the dark-mode-
  //    safe styling rationale — .maplibregl-popup-content is always a plain white box) ──────────

  private popupContainer(minWidthClass = 'min-w-[200px]'): HTMLDivElement {
    const container = document.createElement('div');
    container.className = `text-sm text-gray-900 ${minWidthClass}`;
    return container;
  }

  private appendPopupRow(rows: HTMLElement, label: string, value: string): void {
    const row = document.createElement('div');
    row.className = 'flex items-baseline gap-1.5';
    const labelEl = document.createElement('span');
    labelEl.className = 'text-gray-500 text-xs uppercase tracking-wide shrink-0';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'text-gray-900 font-medium';
    valueEl.textContent = value;
    row.append(labelEl, valueEl);
    rows.append(row);
  }

  private showLoadingPopup(lngLat: maplibregl.LngLatLike): maplibregl.Popup {
    const map = this.map!;
    const container = this.popupContainer('min-w-[180px]');
    container.classList.add('flex', 'items-center', 'gap-2', 'py-0.5');
    const spinner = document.createElement('span');
    spinner.className = 'inline-block w-3.5 h-3.5 shrink-0 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin';
    const label = document.createElement('span');
    label.className = 'text-gray-700';
    label.textContent = 'Loading field details…';
    container.append(spinner, label);
    return new maplibregl.Popup({ closeButton: true, maxWidth: '240px' }).setLngLat(lngLat).setDOMContent(container).addTo(map);
  }

  /** Terminal read-only popup — no "Confirm this field" button, no persistence, just reference info.
   *  `title` is optional (only `showFieldContextPinPopup` passes one, to label which tier — CLU vs.
   *  Parcel — the shown acreage/highlight came from; `showReadOnlyFieldPopup`'s click-to-inspect
   *  flow leaves it undefined, unchanged from before).
   *
   *  `positionAboveMarker` is ALSO only ever passed by `showFieldContextPinPopup` — that popup
   *  anchors to a SELECTED BID-SHEET PIN's coordinate, which already has its OWN marker box (a
   *  colored name/bid label with its own downward-pointing tip) sitting at that exact spot. Popups
   *  default-anchor to the SAME point the same way, so without this flag the popup would render
   *  directly ON TOP of the marker's box instead of above it, AND draw a second, redundant pointer
   *  tip. `showReadOnlyFieldPopup`'s click-to-inspect popup has no such marker to avoid (it anchors
   *  to an arbitrary click point on a CLU/parcel polygon, not a pin) so it never passes this flag
   *  and keeps its default anchor/tip, unchanged. */
  private showInfoPopup(
    lngLat: maplibregl.LngLatLike,
    info: {
      acreage: number | null;
      county: string | null;
      state: string | null;
      topCrop: string | null;
      owner: string | null;
      title?: string;
      error?: boolean;
    },
    popupOptions?: { positionAboveMarker?: boolean },
  ): maplibregl.Popup {
    const map = this.map!;
    const container = this.popupContainer();

    if (info.title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5';
      titleEl.textContent = info.title;
      container.append(titleEl);
    }

    if (info.error) {
      const msg = document.createElement('div');
      msg.className = 'text-red-700';
      msg.textContent = 'Could not retrieve field details — check your connection and try again.';
      container.append(msg);
    } else {
      const rows = document.createElement('div');
      rows.className = 'space-y-1';
      this.appendPopupRow(rows, 'Acres', info.acreage != null ? info.acreage.toFixed(1) : 'Unavailable');
      if (info.county || info.state) {
        this.appendPopupRow(rows, 'Location', [info.county, info.state].filter((v): v is string => !!v).join(', '));
      }
      if (info.topCrop) this.appendPopupRow(rows, 'Top crop', info.topCrop);
      if (info.owner) this.appendPopupRow(rows, 'Owner', info.owner);
      container.append(rows);
    }

    const popup = new maplibregl.Popup({
      closeButton: true,
      maxWidth: '280px',
      ...(popupOptions?.positionAboveMarker ? { anchor: 'bottom' as const, offset: FIELD_CONTEXT_POPUP_OFFSET_PX } : {}),
    })
      .setLngLat(lngLat)
      .setDOMContent(container)
      .addTo(map);

    if (popupOptions?.positionAboveMarker) {
      // The marker's own tip already visually connects the box to this point — this popup doesn't
      // need a second one pointing at the same spot.
      popup.getElement()?.querySelector('.maplibregl-popup-tip')?.remove();
    }

    return popup;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private toNumber(value: unknown): number | null {
    const n = Number(value);
    return value != null && Number.isFinite(n) ? n : null;
  }

  private toDisplayString(value: unknown): string | null {
    if (value == null) return null;
    const s = String(value).trim();
    return s.length > 0 ? s : null;
  }

  /** Highest-percentage CDL crop in a breakdown, or null if none carry a usable percentage. */
  private topCrop(breakdown: ReadonlyArray<{ crop: string; percentOfAoi: number | null }>): { name: string; pct: number } | null {
    let best: { crop: string; percentOfAoi: number } | null = null;
    for (const entry of breakdown) {
      if (entry.percentOfAoi == null) continue;
      if (!best || entry.percentOfAoi > best.percentOfAoi) best = { crop: entry.crop, percentOfAoi: entry.percentOfAoi };
    }
    return best ? { name: best.crop, pct: best.percentOfAoi } : null;
  }

  // ── Map bootstrap ─────────────────────────────────────────────────────────

  private azureTileUrl(tilesetId: string): string {
    const key = this.azureMapsKey() ?? '';
    return (
      `https://atlas.microsoft.com/map/tile?api-version=2.0&tilesetId=${tilesetId}` +
      `&zoom={z}&x={x}&y={y}&subscription-key=${key}`
    );
  }

  private initMap(): void {
    const container = this.mapContainerRef.nativeElement;

    this.map = new maplibregl.Map({
      container,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      style: {
        version: 8,
        sources: {
          [STREET_SOURCE_ID]: {
            type: 'raster',
            tiles: [this.azureTileUrl(AZURE_STREET_TILESET)],
            tileSize: 256,
            attribution: '© Microsoft — Azure Maps',
          },
          [IMAGERY_SOURCE_ID]: {
            type: 'raster',
            tiles: [this.azureTileUrl(AZURE_IMAGERY_TILESET)],
            tileSize: 256,
            attribution: '© Microsoft — Azure Maps',
          },
          [HYBRID_OVERLAY_SOURCE_ID]: {
            type: 'raster',
            tiles: [this.azureTileUrl(AZURE_HYBRID_TILESET)],
            tileSize: 256,
            attribution: '© Microsoft — Azure Maps',
          },
        },
        layers: [
          // Street is the default view (layout visibility omitted = visible), matching today's
          // OSM-street default — see docs/poc/bid-sheet-map/00-overview.md settled decision 2.
          { id: STREET_LAYER_ID, type: 'raster', source: STREET_SOURCE_ID },
          { id: IMAGERY_LAYER_ID, type: 'raster', source: IMAGERY_SOURCE_ID, layout: { visibility: 'none' } },
          { id: HYBRID_OVERLAY_LAYER_ID, type: 'raster', source: HYBRID_OVERLAY_SOURCE_ID, layout: { visibility: 'none' } },
        ],
      },
    });

    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

    this.resizeObserver = new ResizeObserver(() => this.map?.resize());
    this.resizeObserver.observe(container);

    this.map.on('click', (e) => {
      if (!this.addLocationMode()) return;
      const { lat, lng } = e.lngLat;
      this.placeAddLocationMarker(lat, lng);
      this.mapClicked.emit({ lat, lng });
      // JIT field-context lookup, trigger 1 of 2 (00-overview.md decision 5) — fires unconditionally
      // on drop (not gated on the CLU/Parcel view toggle), but only when a vendor key is configured
      // at all; `runFieldContextLookup` itself no-ops (no emit) without one.
      void this.runFieldContextLookup(lat, lng);
    });

    this.map.on('zoomend', () => {
      if (this.zoomDebounceTimer) clearTimeout(this.zoomDebounceTimer);
      this.zoomDebounceTimer = setTimeout(() => {
        if (this.map) this.zoomChanged.emit(this.map.getZoom());
      }, ZOOM_DEBOUNCE_MS);
    });

    this.map.on('load', () => {
      this.loaded.set(true);
    });
  }

  // ── Add-location pin-drop ────────────────────────────────────────────────

  private placeAddLocationMarker(lat: number, lng: number): void {
    if (!this.map) return;
    this.addLocationMarker?.remove();
    const el = document.createElement('div');
    el.innerHTML = `<div style="width:28px;height:28px;background:#EF4623;border:3px solid #DF3410;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.4);">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
    </div>`;
    this.addLocationMarker = new maplibregl.Marker({ element: el.firstElementChild as HTMLElement, anchor: 'center' })
      .setLngLat([lng, lat])
      .addTo(this.map);
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  private fitToVisibleGroups(): void {
    const map = this.map;
    if (!map) return;
    const groups = this.renderModel().groups;
    if (groups.length === 0) return;
    if (groups.length === 1) {
      map.flyTo({
        center: [groups[0].lng, groups[0].lat],
        zoom: 10,
        padding: { top: 0, bottom: 0, left: 0, right: this.panelWidthPx() },
      });
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const g of groups) bounds.extend([g.lng, g.lat]);
    map.fitBounds(bounds, {
      padding: { top: 50, left: 50, right: this.panelWidthPx() + 20, bottom: 80 },
      maxZoom: 12,
    });
  }

  // ── Marker rendering (DOM markers — ports _refreshMapMarkers/_buildStackedLabel/_buildHoverIcon/
  //    _bindHoverExpand/_spreadOverlappingPins from the Leaflet path onto MapLibre's equivalent
  //    project()/unproject() calls) ────────────────────────────────────────

  private redrawMarkers(rm: BidSheetMapRenderModel): void {
    const map = this.map;
    if (!map) return;

    // Clear all previously-rendered bid-location markers before redrawing.
    for (const rendered of this.renderedMarkers) rendered.marker.remove();
    this.renderedMarkers = [];
    this.hoveredMarker = null;

    // Keep map clean during add-location mode — matches the Leaflet path.
    if (this.addLocationMode()) return;

    const groups = rm.groups;
    if (groups.length === 0) return;

    const zoom = map.getZoom();
    const displayPos = this.spreadOverlappingPins(groups.map((g) => [g.lat, g.lng] as [number, number]));

    groups.forEach((g, gi) => {
      const [lat, lng] = displayPos[gi];
      this.renderGroup(g, lat, lng, zoom);
    });
  }

  private renderGroup(g: BidSheetMapRenderGroup, lat: number, lng: number, zoom: number): void {
    const map = this.map;
    if (!map) return;

    if (g.pinKind === 'expanded') {
      const html = this.buildHoverHtml(g.hover.name, g.hover.bid, g.hover.bg, g.hover.border);
      this.addMarker(g, lat, lng, html, html, 'bottom', 1000);
      return;
    }

    if (g.pinKind === 'dot') {
      const { bg, border } = g.items[0] ?? { bg: '#9ca3af', border: '#6b7280' };
      const html = `<div style="width:14px;height:14px;background:${bg};border:2px solid ${border};border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:pointer;"></div>`;
      const hoverHtml = this.buildHoverHtml(g.hover.name, g.hover.bid, g.hover.bg, g.hover.border);
      this.addMarker(g, lat, lng, html, hoverHtml, 'center', 0);
      return;
    }

    if (g.pinKind === 'bidPills') {
      const html = this.buildBidPillsHtml(g.items);
      const primary = g.items[0] ?? { bg: g.hover.bg, border: g.hover.border };
      const hoverHtml = this.buildHoverHtml(g.hover.name, g.hover.bid, primary.bg, primary.border);
      this.addMarker(g, lat, lng, html, hoverHtml, 'bottom', 0);
      return;
    }

    // nameLabels
    const bg = g.items[0]?.bg ?? '#9ca3af';
    const border = g.items[0]?.border ?? '#6b7280';
    const html = this.buildStackedLabelHtml(g.names, bg, border);
    const hoverHtml = this.buildHoverHtml(g.hover.name, g.hover.bid, bg, border);
    this.addMarker(g, lat, lng, html, hoverHtml, 'bottom', 0);
  }

  private addMarker(
    g: BidSheetMapRenderGroup,
    lat: number,
    lng: number,
    html: string,
    hoverHtml: string,
    anchor: 'bottom' | 'center',
    zIndex: number,
  ): void {
    const map = this.map;
    if (!map) return;

    const el = document.createElement('div');
    el.innerHTML = html;
    const contentEl = (el.firstElementChild as HTMLElement) ?? el;
    contentEl.style.zIndex = zIndex ? String(zIndex) : '';

    const marker = new maplibregl.Marker({ element: contentEl, anchor }).setLngLat([lng, lat]).addTo(map);

    // originalHtml is the CONTENT inside contentEl (not contentEl itself) — hover swap/reset only
    // ever touches innerHTML, never outerHTML, so the element MapLibre's Marker holds a reference
    // to is never replaced/detached.
    const rendered: RenderedMarker = { marker, el: contentEl, originalHtml: contentEl.innerHTML, hoverHtml };

    contentEl.addEventListener('click', (e) => {
      // Stop this click from ALSO bubbling into MapLibre's own map-level click handling. Marker
      // elements are DOM descendants of the same container MapLibre listens on for its layer-click
      // delegation (`wireVendorLayerInteractions`'s CLU/parcel click-to-inspect handlers included) —
      // despite being visually "on top" via absolute positioning, a native click on this element
      // still bubbles up through that shared container, and MapLibre's delegation hit-tests purely
      // by PIXEL POSITION, not by which DOM element actually received the click. Without this,
      // clicking a pin sitting on top of a CLU/parcel polygon (very common — pins usually sit inside
      // a rendered field) ALSO fired that polygon's OWN click-to-inspect popup for the exact same
      // physical click, producing two popups at once whenever CLU/Parcel mode was active and the
      // click selected a previously-unselected pin (reported bug: "a click is also being registered
      // on the map ... within the map point's name box this should not register as a click on the
      // map").
      e.stopPropagation();
      const name = g.names[0];
      const loc = this.locations().find((l) => l.name === name);
      if (!loc) return;
      // JIT field-context lookup, trigger 2 of 2 (00-overview.md decision 5), no longer fires from
      // here: this component doesn't know whether the parent's `selectedLocationName` toggle will
      // treat this click as a NEW selection or a deselection/repeat-click on an already-selected pin
      // (only the parent knows that, since it owns the selection state). The parent now decides and
      // commands the lookup back down via `fieldContextLookupCmd` — see that effect in the
      // constructor. This still gates on the CLU/Parcel toggle, just in that effect instead of here.
      this.locationSelected.emit(loc);
    });

    // Expanded (panel-open) groups are already the expanded card — no hover-swap needed.
    if (g.pinKind !== 'expanded') {
      contentEl.addEventListener('mouseenter', () => {
        // Reset any other marker still stuck on its hover state (mirrors the Leaflet path's
        // _hoveredMarker force-reset bookkeeping for the same stuck-hover hazard).
        if (this.hoveredMarker && this.hoveredMarker !== rendered) {
          this.hoveredMarker.el.innerHTML = this.hoveredMarker.originalHtml;
          this.hoveredMarker.el.style.zIndex = '';
        }
        contentEl.innerHTML = hoverHtml;
        contentEl.style.zIndex = '2000';
        this.hoveredMarker = rendered;
      });
      contentEl.addEventListener('mouseleave', () => {
        contentEl.innerHTML = rendered.originalHtml;
        contentEl.style.zIndex = zIndex ? String(zIndex) : '';
        if (this.hoveredMarker === rendered) this.hoveredMarker = null;
      });
    }

    this.renderedMarkers.push(rendered);
  }

  /**
   * Spreads pins whose on-screen positions would overlap so none get hidden behind another — ports
   * `_spreadOverlappingPins` from the Leaflet path onto MapLibre's `map.project()`/`map.unproject()`
   * (no explicit-zoom overload on MapLibre, so this uses the live view — pixel deltas between two
   * points are zoom-dependent but pan-independent, so this is equivalent for decluttering purposes).
   */
  private spreadOverlappingPins(points: [number, number][]): [number, number][] {
    const map = this.map;
    if (!map || points.length < 2) return points;
    const pts = points.map(([lat, lng]) => map.project([lng, lat]));

    const parent = points.map((_, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        if (dx * dx + dy * dy < OVERLAP_PX * OVERLAP_PX) parent[find(i)] = find(j);
      }
    }
    const clusters = new Map<number, number[]>();
    for (let i = 0; i < pts.length; i++) {
      const r = find(i);
      const arr = clusters.get(r) ?? [];
      arr.push(i);
      clusters.set(r, arr);
    }

    const out: [number, number][] = points.slice();
    for (const members of clusters.values()) {
      if (members.length < 2) continue;
      let cx = 0;
      let cy = 0;
      for (const i of members) {
        cx += pts[i].x;
        cy += pts[i].y;
      }
      cx /= members.length;
      cy /= members.length;
      members.forEach((i, idx) => {
        const vx = pts[i].x - cx;
        const vy = pts[i].y - cy;
        const d = Math.sqrt(vx * vx + vy * vy);
        let nx: number;
        let ny: number;
        if (d < 0.001) {
          const ang = (2 * Math.PI * idx) / members.length;
          nx = cx + SPREAD_PX * Math.cos(ang);
          ny = cy + SPREAD_PX * Math.sin(ang);
        } else if (d < SPREAD_PX) {
          const s = SPREAD_PX / d;
          nx = cx + vx * s;
          ny = cy + vy * s;
        } else {
          return; // already far enough apart — keep the true position
        }
        const ll = map.unproject([nx, ny]);
        out[i] = [ll.lat, ll.lng];
      });
    }
    return out;
  }

  // ── HTML builders (ports of _buildStackedLabel/_buildHoverIcon — identical XSS posture: content
  //    is self-generated + esc()-escaped location names, same as today) ───────────────────────

  private esc(str: string): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private buildStackedLabelHtml(names: string[], bg: string, border: string): string {
    const isGrey = bg === '#d1d5db' || bg === '#9ca3af';
    const labelBg = isGrey ? '#6b7280' : bg;
    const labelBorder = isGrey ? '#4b5563' : border;
    const maxWidth = Math.min(150, Math.max(85, ...names.map((n) => n.length * 7 + 22)));
    const linesHtml = names
      .map(
        (n) =>
          `<div style="background:${labelBg};border:2px solid ${labelBorder};border-radius:5px;padding:4px 8px;font-size:11px;font-weight:700;color:#fff;white-space:nowrap;line-height:1.2;overflow:hidden;text-overflow:ellipsis;max-width:${maxWidth}px;">${this.esc(n)}</div>`,
      )
      .join('');
    return `<div style="position:relative;width:${maxWidth}px;text-align:center;display:flex;flex-direction:column;gap:2px;align-items:center;cursor:pointer;">
      ${linesHtml}
      <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${labelBorder};margin:-1px auto 0;"></div>
    </div>`;
  }

  private buildBidPillsHtml(items: { label: string; bg: string; border: string }[]): string {
    const linesHtml = items
      .map(({ label, bg, border }) => {
        const isGrey = bg === '#d1d5db';
        const pillBg = isGrey ? '#6b7280' : bg;
        const pillBorder = isGrey ? '#4b5563' : border;
        return `<div style="background:${pillBg};border:2px solid ${pillBorder};border-radius:6px;padding:5px 6px;font-size:11px;font-weight:700;color:#fff;white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.3);line-height:1.2;cursor:pointer;">${this.esc(label)}</div>`;
      })
      .join('');
    const maxWidth = Math.max(58, ...items.map(({ label }) => label.length * 7 + 16));
    const primaryBg = items[0]?.bg ?? '#6b7280';
    return `<div style="position:relative;width:${maxWidth}px;text-align:center;display:flex;flex-direction:column;gap:2px;align-items:center;cursor:pointer;">
      ${linesHtml}
      <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${primaryBg};margin:-1px auto 0;"></div>
    </div>`;
  }

  private buildHoverHtml(name: string, bid: string, bg: string, border: string): string {
    const nameHtml = `<div style="font-size:11px;font-weight:700;color:#fff;white-space:nowrap;line-height:1.2;">${this.esc(name)}</div>`;
    const bidLabel = bid || '--';
    const subHtml = bid
      ? `<div style="font-size:10px;font-weight:500;color:rgba(255,255,255,0.85);white-space:nowrap;line-height:1.2;margin-top:2px;">${this.esc(bidLabel)}</div>`
      : '';
    return `<div style="position:relative;text-align:center;display:flex;flex-direction:column;align-items:center;cursor:pointer;">
      <div style="background:${bg};border:2px solid ${border};border-radius:8px;padding:5px 9px;box-shadow:0 3px 10px rgba(0,0,0,0.3);">${nameHtml}${subHtml}</div>
      <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid ${bg};margin:-1px auto 0;"></div>
    </div>`;
  }
}
