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
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from 'geojson';
import { Customer, CustomerFieldTag, CropBreakdownEntry, FieldTagDraft, FieldTagMapConfig } from '@models';
import { FIELD_TAG_METHOD_STYLE, FIELD_TAG_METHOD_FALLBACK_COLOR } from '../../field-tag-style';
import {
  mergeLandMapMagicLayers,
  setLayerGroupVisibility,
  type LmmLayerIds,
} from '../../../../shared/services/land-map-magic/lmm-styles.service';
import { pointLookup, type LookupField } from '../../../../shared/services/land-map-magic/lmm-point-lookup';
import { aoiQuery } from '../../../../shared/services/land-map-magic/lmm-aoi-query';
import { setupDraw, type DrawController } from '../../services/field-tagging/draw-setup';
import {
  geometryAcres,
  toAoiFeature,
  unionGeometries,
  pickPolygonGeometry,
  round1,
  drawnExternalRef,
  normalizeWinding,
  paddedBoundingBoxPolygon,
  pointInPolygon,
  polygonsIntersect,
} from '../../../../shared/services/land-map-magic/geo';

/**
 * FieldTagMapComponent — MapLibre GL map for the Field Tagging POC.
 * See docs/poc/field-tagging/03-frontend-map-component.md for the full design this ports (that
 * doc, in turn, ports lcfs-poc's proven MapLibre + LandMapMagic integration). Every gotcha (G1-G13)
 * referenced in comments below is documented there and verified against the real vendor API.
 *
 * Review mode: renders already-saved tags + the customer's address pin. Zero vendor network calls.
 * Select mode: overlays LandMapMagic CLU/parcel vector tiles for click-to-select (Tier 1/2) plus
 * hand-drawn polygons (Tier 4). Confirm = immediate `fieldConfirmed` emit; the parent POSTs and
 * appends to `tags`, which flows back in and re-renders instantly. The picker stays open.
 */

type Tier = 'clu' | 'parcel' | 'draw';

interface FeatureStateRef {
  source: string;
  sourceLayer?: string;
  id: string | number;
}

/**
 * One already-loaded parcel fragment-group overlapping a click point or a drawn polygon — see
 * `findOverlappingParcels`. `id` is the parcels source's own promoted feature id (real `parcel_id`,
 * confirmed working — unlike CLU's broken promoteId, G1), reused directly for feature-state
 * lookups (hover-highlight, selection) without any extra type conversion.
 */
interface ParcelOwnerMatch {
  id: string | number;
  parcelId: string;
  owner: string | null;
  acreage: number | null;
}

const AZURE_SOURCE_ID = 'azure-imagery';
const TAGGED_SOURCE_ID = 'tagged-fields';
const TAGGED_FILL_LAYER_ID = 'tagged-fields-fill';
const TAGGED_OUTLINE_LAYER_ID = 'tagged-fields-outline';
const TAGGED_OUTLINE_DASHED_LAYER_ID = 'tagged-fields-outline-dashed';

// Basemap layers — all three still added up-front in initMap()'s initial style, at the bottom of
// the layer stack, and switched only via setLayoutProperty visibility toggles (never
// map.setStyle(), which would wipe the tagged-fields source and merged vendor CLU/parcel layers).
// The UI toggle itself only exposes two user-facing choices (Map / Satellite) — the former plain
// "Satellite" (imagery-only, no overlay) option was removed as redundant with the richer
// imagery+overlay combination, which now carries the "Satellite" label instead of its old "Hybrid"
// one. Internal ids/constants below intentionally keep their "hybrid" naming (imagery + the
// transparent roads/labels/boundaries overlay is still exactly what those internals model) — only
// the user-facing label changed, so this comment and the setBasemap() cases still say "hybrid"
// where that's what's actually being toggled. Verified live against atlas.microsoft.com/map/tile:
// microsoft.imagery and microsoft.base.road are opaque raster PNGs; microsoft.base.hybrid.road is a
// transparent raster PNG suitable for stacking over imagery; microsoft.base.hybrid is a VECTOR
// tileset and is NOT used here.
const STREET_SOURCE_ID = 'azure-street';
const HYBRID_OVERLAY_SOURCE_ID = 'azure-hybrid-overlay';
const IMAGERY_LAYER_ID = AZURE_SOURCE_ID; // matches existing pattern where layer id == source id
const STREET_LAYER_ID = 'azure-street';
const HYBRID_OVERLAY_LAYER_ID = 'azure-hybrid-overlay';
const AZURE_IMAGERY_TILESET = 'microsoft.imagery';
const AZURE_STREET_TILESET = 'microsoft.base.road';
const AZURE_HYBRID_TILESET = 'microsoft.base.hybrid.road';
// 'satellite' renders the SAME imagery+hybrid-overlay combination the old 'hybrid' choice did —
// only the label changed, not the underlying tileset/layer mechanics (see setBasemap()).
type BasemapStyle = 'street' | 'satellite';

const DEFAULT_CENTER: [number, number] = [-98.5795, 39.8283]; // CONUS geographic center
const DEFAULT_ZOOM = 4;
const REVIEW_ZOOM_NO_TAGS = 13;
const SELECT_MODE_ZOOM = 15; // G12: CLU tiles only render at zoom >= 12; 15 lands comfortably inside range
const SEARCH_RESULT_ZOOM = 13;

// G10/G13: the AOI endpoint only returns features that geographically intersect the SUBMITTED
// polygon. `sourceGeometry` can be a single small tile-clipped fragment, so pad its bounding box
// before querying to reliably reach sibling fragments sitting in an adjacent MVT tile (CLU tier
// only — see confirmSelection). This is a generous-but-cheap margin, not a precise figure.
const CLU_AOI_PADDING_METERS = 400;

// G10/G13 (confirmed against the live vendor API): calcacres is a TRACT-level attribute shared
// verbatim by every tile-clipped fragment of the same physical field/FSA tract record — genuine
// same-tract fragments matched essentially exactly (to the hundredth of an acre) in a live sample
// of 87 AOI-response features / 20 fragment-groups, with zero false-positive collisions between
// distinct fields at this precision. Kept tight (not the old 0.5ac-or-1% band) specifically to
// avoid grouping genuinely distinct nearby fields that happen to share a rounded acreage.
const CLU_CALCACRES_TOLERANCE = 0.02;

const TIER_HINTS: Record<Tier, string> = {
  clu: '',
  parcel: 'Parcel boundaries may include non-farmable area such as farmsteads, roads, and timber.',
  draw: 'Click the map to place vertices; double-click to finish your field boundary.',
};

@Component({
  selector: 'app-field-tag-map',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './field-tag-map.component.html',
})
export class FieldTagMapComponent {
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('mapContainer', { static: true }) private mapContainerRef!: ElementRef<HTMLDivElement>;

  // ── Inputs (parent-owned) ────────────────────────────────────────────────
  readonly customer = input.required<Customer>();
  readonly tags = input<CustomerFieldTag[]>([]);
  readonly mode = input<'review' | 'select'>('review');
  readonly hoveredTagId = input<number | null>(null);
  /**
   * Click-to-fly "command", modeled as `{ tagId, nonce }` rather than a bare `number | null` so
   * that clicking the SAME list row twice still re-fires `fitBounds` — plain signal equality on a
   * repeated tagId would otherwise swallow the second click (04-frontend-list-and-hover-sync.md →
   * "Click-to-fly"; the parent bumps `nonce` on every row click).
   */
  readonly flyToTagId = input<{ tagId: number; nonce: number } | null>(null);
  readonly mapConfig = input.required<FieldTagMapConfig>();
  readonly searchPending = input<boolean>(false);
  /**
   * Address-search "fly" command, mirroring `flyToTagId`'s nonce pattern (same reason: a repeat
   * search for the identical string must still re-fire flyTo — plain signal equality on identical
   * coordinates would otherwise swallow it).
   */
  readonly flyToLocation = input<{ lat: number; lng: number; nonce: number } | null>(null);

  // ── Outputs ───────────────────────────────────────────────────────────────
  readonly tagHover = output<number | null>();
  readonly fieldConfirmed = output<FieldTagDraft>();
  readonly duplicateAttempted = output<string>();
  readonly selectError = output<string>();
  readonly addressSearch = output<string>();

  // ── Template-facing state (tier selector / legend) ──────────────────────
  readonly currentTier = signal<Tier>('clu');
  readonly tierHint = signal<string>('');
  readonly methodStyle = FIELD_TAG_METHOD_STYLE;
  readonly isSelectMode = signal(false);
  readonly basemapStyle = signal<BasemapStyle>('street'); // Map is the default view
  readonly addressSearchText = signal('');

  private map: maplibregl.Map | null = null;
  private readonly loaded = signal(false);
  private customerMarker: maplibregl.Marker | null = null;
  private lmmLayers: LmmLayerIds = { clu: [], parcels: [], cluFill: [], parcelFill: [] };
  private vendorLayersMerged = false;
  private drawController: DrawController | null = null;
  private activePopup: maplibregl.Popup | null = null;
  /** Vendor-layer (CLU/parcel) hover/selected refs — distinct from the app's own tagged-fields hover state. */
  private hoveredVendorFeature: FeatureStateRef | null = null;
  private selectedVendorFeature: FeatureStateRef | null = null;
  /** Currently popup-hover-highlighted parcel (see `parcels-popup-highlight` in lmm-styles.service.ts). */
  private popupHighlightedParcel: FeatureStateRef | null = null;
  /** Last tagId we set `hover` feature-state for on the `tagged-fields` source. */
  private currentTaggedHoverId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  /** Tracks whether `customer().coordinates` has ever been non-null, so the one-time "coordinates
   *  just resolved" recenter (below) fires exactly once — not on every subsequent `customer()`
   *  reference change once coordinates are already known. */
  private _hadCustomerCoords = false;

  constructor() {
    afterNextRender(() => this.initMap());
    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.map?.remove();
    });

    // customer().coordinates -> marker + one-time recenter. The parent (CustomerFieldsComponent)
    // resolves coordinates asynchronously (on-demand geocode call) and they typically arrive
    // AFTER initMap()/onMapLoad() have already run with the CONUS default view — this effect is
    // what actually moves the camera once they land. Guarded so later `customer()` reference
    // changes (once coordinates are already known) don't keep yanking the camera back.
    effect(() => {
      const coords = this.customer().coordinates;
      if (!this.loaded()) return;
      this.addOrUpdateCustomerMarker();
      if (coords && !this._hadCustomerCoords) {
        this._hadCustomerCoords = true;
        // Recenter regardless of which mode we're in when coordinates land — if the user has
        // already switched to select mode before the async geocode call resolves (e.g. clicking
        // "Add field" immediately), the map must still move off its CONUS default; it doesn't
        // get a second chance once `_hadCustomerCoords` flips true.
        if (this.mode() === 'review') {
          this.fitReviewBounds();
        } else {
          this.map?.flyTo({ center: [coords.lng, coords.lat], zoom: SELECT_MODE_ZOOM });
        }
      } else if (coords) {
        this._hadCustomerCoords = true;
      }
    });

    // tags -> setData + review-mode refit. Guarded on "map loaded"; because effects re-run
    // whenever any read signal changes, this naturally buffers the latest value until `loaded`
    // flips true, then flushes (Angular integration note in 03-frontend-map-component.md).
    effect(() => {
      const tags = this.tags();
      if (!this.loaded()) return;
      this.setTaggedFieldsData(tags);
      if (this.mode() === 'review') this.fitReviewBounds();
    });

    // mode -> enter/exit select
    effect(() => {
      const mode = this.mode();
      this.isSelectMode.set(mode === 'select');
      if (!this.loaded()) return;
      if (mode === 'select') void this.enterSelectMode();
      else this.exitSelectMode();
    });

    // hoveredTagId (list -> map) -> feature-state
    effect(() => {
      const id = this.hoveredTagId();
      if (!this.loaded()) return;
      this.setTaggedFieldHoverState(id);
    });

    // flyToTagId (row click -> camera) -> fitBounds. Reads .tagId out of the command envelope;
    // the .nonce field exists purely so repeat clicks on the same row still change the input value.
    effect(() => {
      const cmd = this.flyToTagId();
      if (!this.loaded() || cmd == null) return;
      this.flyToTag(cmd.tagId);
    });

    // flyToLocation (address search -> camera) -> flyTo. Mirrors flyToTagId above.
    effect(() => {
      const loc = this.flyToLocation();
      if (!this.loaded() || loc == null) return;
      this.map?.flyTo({ center: [loc.lng, loc.lat], zoom: SEARCH_RESULT_ZOOM });
    });
  }

  /** Tier selector click handler (template-bound). */
  onTierChange(tier: Tier): void {
    this.currentTier.set(tier);
    this.tierHint.set(TIER_HINTS[tier]);
    this.activePopup?.remove();
    this.activePopup = null;

    const map = this.map;
    if (!map) return;

    if (tier === 'draw') {
      this.drawController?.activate();
    } else {
      this.drawController?.deactivate();
    }

    // Parcels stay visible for BOTH the parcel tier itself and while drawing (Tier 4) — seeing
    // parcel boundaries/owner labels while hand-drawing helps the originator see which parcels
    // their polygon spans as they draw. This is purely visual: wireVendorLayerInteractions already
    // gates parcel click/hover-to-select on `currentTier() === 'parcel'`, so clicks in draw mode
    // still go only to the draw controller, never the parcel click-to-select handler.
    setLayerGroupVisibility(map, this.lmmLayers.clu, tier === 'clu');
    setLayerGroupVisibility(map, this.lmmLayers.parcels, tier === 'parcel' || tier === 'draw');
  }

  /** Address-search submit handler (template-bound). */
  emitAddressSearch(): void {
    const q = this.addressSearchText().trim();
    if (q) this.addressSearch.emit(q);
  }

  /**
   * Basemap toggle (template-bound). Switches visibility only via setLayoutProperty — never
   * map.setStyle(), which would wipe the tagged-fields source and merged vendor CLU/parcel layers.
   */
  setBasemap(style: BasemapStyle): void {
    this.basemapStyle.set(style);
    const map = this.map;
    if (!map || !map.getLayer(IMAGERY_LAYER_ID)) return; // guard until style loaded, matching other methods' pattern
    map.setLayoutProperty(STREET_LAYER_ID, 'visibility', style === 'street' ? 'visible' : 'none');
    // 'satellite' = imagery + the transparent hybrid roads/labels/boundaries overlay, exactly what
    // the old 'hybrid' choice rendered — both layers toggle together.
    map.setLayoutProperty(IMAGERY_LAYER_ID, 'visibility', style === 'satellite' ? 'visible' : 'none');
    map.setLayoutProperty(HYBRID_OVERLAY_LAYER_ID, 'visibility', style === 'satellite' ? 'visible' : 'none');
  }

  // ── Map bootstrap ─────────────────────────────────────────────────────────

  private azureTileUrl(tilesetId: string): string {
    const key = this.mapConfig().azureMapsKey ?? '';
    return (
      `https://atlas.microsoft.com/map/tile?api-version=2.0&tilesetId=${tilesetId}` +
      `&zoom={z}&x={x}&y={y}&subscription-key=${key}`
    );
  }

  private initMap(): void {
    const container = this.mapContainerRef.nativeElement;

    const coords = this.customer().coordinates;
    const center: [number, number] = coords ? [coords.lng, coords.lat] : DEFAULT_CENTER;
    const zoom = coords ? REVIEW_ZOOM_NO_TAGS : DEFAULT_ZOOM;

    this.map = new maplibregl.Map({
      container,
      center,
      zoom,
      style: {
        version: 8,
        sources: {
          [STREET_SOURCE_ID]: {
            type: 'raster',
            tiles: [this.azureTileUrl(AZURE_STREET_TILESET)],
            tileSize: 256,
            attribution: '© Microsoft — Azure Maps',
          },
          [AZURE_SOURCE_ID]: {
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
          // Street (Map) is the default view — see basemapStyle's initial value above.
          { id: STREET_LAYER_ID, type: 'raster', source: STREET_SOURCE_ID },
          { id: IMAGERY_LAYER_ID, type: 'raster', source: AZURE_SOURCE_ID, layout: { visibility: 'none' } },
          { id: HYBRID_OVERLAY_LAYER_ID, type: 'raster', source: HYBRID_OVERLAY_SOURCE_ID, layout: { visibility: 'none' } },
        ],
      },
    });

    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

    this.resizeObserver = new ResizeObserver(() => this.map?.resize());
    this.resizeObserver.observe(container);

    this.map.on('load', () => this.onMapLoad());
  }

  private onMapLoad(): void {
    const map = this.map;
    if (!map) return;

    map.addSource(TAGGED_SOURCE_ID, {
      type: 'geojson',
      data: this.buildTaggedFieldsCollection(this.tags()),
      promoteId: 'tagId',
    });

    map.addLayer({
      id: TAGGED_FILL_LAYER_ID,
      type: 'fill',
      source: TAGGED_SOURCE_ID,
      paint: {
        'fill-color': this.methodColorExpression(),
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.35, 0.15],
      },
    });

    // `line-dasharray` is not a data-driven property in the MapLibre/Mapbox style spec — it
    // cannot key off ['get', 'sourceMethod'] the way color/width can. The standard workaround
    // is to split into two layers filtered by the property instead, each with its own literal
    // dasharray. Drawn fields get a dashed outline as a second visual channel beyond color
    // (helps colorblind users distinguish drawn fields without relying on hue).
    map.addLayer({
      id: TAGGED_OUTLINE_LAYER_ID,
      type: 'line',
      source: TAGGED_SOURCE_ID,
      filter: ['!=', ['get', 'sourceMethod'], 'drawn'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': this.methodColorExpression(),
        'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 4, 2],
      },
    });

    map.addLayer({
      id: TAGGED_OUTLINE_DASHED_LAYER_ID,
      type: 'line',
      source: TAGGED_SOURCE_ID,
      filter: ['==', ['get', 'sourceMethod'], 'drawn'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': this.methodColorExpression(),
        'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 4, 2],
        'line-dasharray': [2, 2],
      },
    });

    this.wireTaggedFieldsHover();
    this.addOrUpdateCustomerMarker();
    this.fitReviewBounds();

    this.loaded.set(true);
  }

  private methodColorExpression(): maplibregl.DataDrivenPropertyValueSpecification<string> {
    return [
      'match',
      ['get', 'sourceMethod'],
      'clu',
      FIELD_TAG_METHOD_STYLE.clu.color,
      'parcel',
      FIELD_TAG_METHOD_STYLE.parcel.color,
      'drawn',
      FIELD_TAG_METHOD_STYLE.drawn.color,
      FIELD_TAG_METHOD_FALLBACK_COLOR,
    ];
  }

  // ── tagged-fields source (review mode + select-mode overlay) ────────────

  private buildTaggedFieldsCollection(tags: CustomerFieldTag[]): FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: tags.flatMap((tag) => {
        try {
          const geometry = JSON.parse(tag.geometryJson) as Geometry;
          return [
            {
              type: 'Feature' as const,
              geometry,
              properties: { tagId: tag.id, sourceMethod: tag.selectionMethod },
            },
          ];
        } catch {
          return [];
        }
      }),
    };
  }

  private setTaggedFieldsData(tags: CustomerFieldTag[]): void {
    const source = this.map?.getSource(TAGGED_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(this.buildTaggedFieldsCollection(tags));
  }

  private wireTaggedFieldsHover(): void {
    const map = this.map;
    if (!map) return;

    map.on('mousemove', TAGGED_FILL_LAYER_ID, (e) => {
      if (this.mode() === 'select') return; // not a click/hover target while selecting
      const f = e.features?.[0];
      if (f?.id == null) return;
      map.getCanvas().style.cursor = 'pointer';
      const tagId = Number(f.id);
      this.setTaggedFieldHoverState(tagId);
      this.tagHover.emit(tagId);
    });
    map.on('mouseleave', TAGGED_FILL_LAYER_ID, () => {
      if (this.mode() === 'select') return;
      map.getCanvas().style.cursor = '';
      this.setTaggedFieldHoverState(null);
      this.tagHover.emit(null);
    });
  }

  /**
   * Feature-state writes are idempotent, so this single helper safely serves both list-originated
   * (hoveredTagId input) and map-originated (mousemove above) hover updates without a feedback
   * loop — see 04-frontend-list-and-hover-sync.md's reasoning, restated here.
   */
  private setTaggedFieldHoverState(tagId: number | null): void {
    const map = this.map;
    if (!map || !map.getSource(TAGGED_SOURCE_ID)) return;
    if (this.currentTaggedHoverId != null) {
      map.setFeatureState({ source: TAGGED_SOURCE_ID, id: this.currentTaggedHoverId }, { hover: false });
    }
    this.currentTaggedHoverId = tagId;
    if (tagId != null) {
      map.setFeatureState({ source: TAGGED_SOURCE_ID, id: tagId }, { hover: true });
    }
  }

  private addOrUpdateCustomerMarker(): void {
    const map = this.map;
    if (!map) return;
    const coords = this.customer().coordinates;
    if (!coords) {
      this.customerMarker?.remove();
      this.customerMarker = null;
      return;
    }
    if (!this.customerMarker) {
      this.customerMarker = new maplibregl.Marker().setLngLat([coords.lng, coords.lat]).addTo(map);
    } else {
      this.customerMarker.setLngLat([coords.lng, coords.lat]);
    }
  }

  private fitReviewBounds(): void {
    const map = this.map;
    if (!map) return;
    const tags = this.tags();
    const coords = this.customer().coordinates;

    if (tags.length === 0) {
      if (coords) {
        map.flyTo({ center: [coords.lng, coords.lat], zoom: REVIEW_ZOOM_NO_TAGS });
      } else {
        map.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
      }
      return;
    }

    const bounds = new maplibregl.LngLatBounds();
    let hasPoint = false;
    for (const tag of tags) {
      const geometry = this.tryParseGeometry(tag.geometryJson);
      if (!geometry) continue;
      for (const pos of this.iterateCoordinates(geometry)) {
        bounds.extend(pos as [number, number]);
        hasPoint = true;
      }
    }
    if (coords) {
      bounds.extend([coords.lng, coords.lat]);
      hasPoint = true;
    }
    if (!hasPoint) return;
    map.fitBounds(bounds, { padding: 40, maxZoom: 16 });
  }

  private flyToTag(tagId: number): void {
    const map = this.map;
    if (!map) return;
    const tag = this.tags().find((t) => t.id === tagId);
    if (!tag) return;
    const geometry = this.tryParseGeometry(tag.geometryJson);
    if (!geometry) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const pos of this.iterateCoordinates(geometry)) bounds.extend(pos as [number, number]);
    map.fitBounds(bounds, { padding: 60, maxZoom: 16 });
  }

  private tryParseGeometry(geometryJson: string): Polygon | MultiPolygon | null {
    try {
      return pickPolygonGeometry(JSON.parse(geometryJson) as Geometry);
    } catch {
      return null;
    }
  }

  private *iterateCoordinates(geometry: Polygon | MultiPolygon): Generator<Position> {
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const rings of polys) {
      for (const ring of rings) {
        for (const pos of ring) yield pos;
      }
    }
  }

  // ── Select mode ───────────────────────────────────────────────────────────

  private async enterSelectMode(): Promise<void> {
    const map = this.map;
    if (!map) return;

    // No recenter/flyTo here: the ONE viewpoint reset for a producer happens when their
    // coordinates first resolve (see the customer().coordinates effect in the constructor, guarded
    // by `_hadCustomerCoords`), which fires once per Fields-tab session regardless of which mode is
    // active at the time. Entering select mode (clicking "Add fields") must never re-fire it — the
    // originator may have already panned/zoomed manually (in review mode, or in a prior select-mode
    // session before clicking "Done"), and clicking "Add fields" again should leave the camera
    // exactly wherever they left it.
    if (!this.vendorLayersMerged) {
      const key = this.mapConfig().landMapMagicKey;
      if (!key) {
        this.selectError.emit('LandMapMagic key is not configured.');
        return;
      }
      try {
        // First entry only: fetch + merge the vendor style. Never map.setStyle() — that would
        // wipe the Azure imagery base AND the tagged-fields source.
        this.lmmLayers = await mergeLandMapMagicLayers(map, key);
        this.vendorLayersMerged = true;
        setLayerGroupVisibility(map, this.lmmLayers.parcels, false);
        this.wireVendorLayerInteractions(this.lmmLayers.cluFill, 'clu');
        this.wireVendorLayerInteractions(this.lmmLayers.parcelFill, 'parcel');
        this.drawController = setupDraw(map, (feature) => void this.onPolygonDrawn(feature));
      } catch (err) {
        console.error('[field-tag-map] Failed to load LandMapMagic layers:', err);
        this.selectError.emit('LandMapMagic layers failed to load.');
        return;
      }
    }

    // Re-entry: the merge guards make it a no-op; just restore visibility for the active tier.
    this.onTierChange(this.currentTier());
  }

  private exitSelectMode(): void {
    const map = this.map;
    if (!map) return;
    setLayerGroupVisibility(map, this.lmmLayers.clu, false);
    setLayerGroupVisibility(map, this.lmmLayers.parcels, false);
    this.drawController?.deactivate();
    this.setVendorSelected(null);
    this.setVendorHover(null);
    this.activePopup?.remove();
    this.activePopup = null;
    this.fitReviewBounds();
  }

  private wireVendorLayerInteractions(fillLayerIds: string[], method: 'clu' | 'parcel'): void {
    const map = this.map;
    if (!map) return;
    for (const layerId of fillLayerIds) {
      map.on('mousemove', layerId, (e) => {
        if (this.currentTier() !== method) return;
        map.getCanvas().style.cursor = 'pointer';
        const f = e.features?.[0];
        if (f?.id != null) {
          this.setVendorHover({ source: f.source, sourceLayer: f.sourceLayer, id: f.id });
        }
      });
      map.on('mouseleave', layerId, () => {
        if (this.currentTier() !== method) return;
        map.getCanvas().style.cursor = '';
        this.setVendorHover(null);
      });
      map.on('click', layerId, (e) => {
        if (this.currentTier() !== method) return;
        void this.handleFieldClick(e, method);
      });
    }
  }

  private setVendorHover(ref: FeatureStateRef | null): void {
    const map = this.map;
    if (!map) return;
    if (this.hoveredVendorFeature) map.setFeatureState(this.hoveredVendorFeature, { hover: false });
    this.hoveredVendorFeature = ref;
    if (ref) map.setFeatureState(ref, { hover: true });
  }

  private setVendorSelected(ref: FeatureStateRef | null): void {
    const map = this.map;
    if (!map) return;
    if (this.selectedVendorFeature) map.setFeatureState(this.selectedVendorFeature, { selected: false });
    this.selectedVendorFeature = ref;
    if (ref) map.setFeatureState(ref, { selected: true });
  }

  /**
   * Hover a parcel/owner row in a popup's owner list -> highlight that parcel's boundary via the
   * always-on `parcels-popup-highlight` layer (see lmm-styles.service.ts) — independent of the
   * current tier, so this works while browsing CLU or drawing, not just the parcel tier itself.
   */
  private setPopupHighlight(ref: FeatureStateRef | null): void {
    const map = this.map;
    if (!map) return;
    if (this.popupHighlightedParcel) map.setFeatureState(this.popupHighlightedParcel, { popupHighlight: false });
    this.popupHighlightedParcel = ref;
    if (ref) map.setFeatureState(ref, { popupHighlight: true });
  }

  /**
   * Find every already-loaded "parcels" MVT fragment-group (grouped/reconstructed by the source's
   * own promoted `parcel_id`, same tile-seam technique as `reconstructFullFieldGeometry`) whose
   * geometry contains `target` (a click point) or intersects it (a hand-drawn polygon). This is a
   * PURELY CLIENT-SIDE spatial query against whatever parcel tiles MapLibre has already fetched —
   * there is no vendor-API equivalent: the AOI endpoint flatly rejects "parcels" as a layer
   * (confirmed live, see `polygonsIntersect` in geo.ts), and Point Lookup never actually returns
   * parcel data either (confirmed live, see lmm-point-lookup.ts). Accuracy is therefore bounded by
   * which parcel tiles are currently loaded — panning/zooming over the area of interest first (the
   * parcels layers stay visible during both the parcel tier AND draw mode specifically so the
   * originator can see this for themselves) improves coverage, but this can still under-report
   * parcels whose tiles haven't loaded yet. "Even the same owner across multiple parcels" is
   * handled naturally: matches are grouped by parcel id, never deduplicated by owner name.
   */
  private findOverlappingParcels(target: { point: Position } | { polygon: Polygon | MultiPolygon }): ParcelOwnerMatch[] {
    const map = this.map;
    if (!map || !map.getSource('parcels')) return [];

    const fragments = map.querySourceFeatures('parcels', { sourceLayer: 'parcels' });
    const byId = new Map<string | number, { id: string | number; geoms: Geometry[]; owner: string | null; acreage: number | null }>();
    for (const f of fragments) {
      if (f.id == null) continue;
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const entry = byId.get(f.id) ?? { id: f.id, geoms: [], owner: null, acreage: null };
      entry.geoms.push(f.geometry as Geometry);
      if (entry.owner == null) entry.owner = this.toDisplayString(props['owner']);
      if (entry.acreage == null) entry.acreage = this.toNumber(props['acreage_calc']);
      byId.set(f.id, entry);
    }

    const matches: ParcelOwnerMatch[] = [];
    for (const entry of byId.values()) {
      const merged = this.unionMergeGeometries(entry.geoms);
      if (!merged) continue;
      const hit = 'point' in target ? pointInPolygon(target.point, merged) : polygonsIntersect(target.polygon, merged);
      if (!hit) continue;
      matches.push({ id: entry.id, parcelId: String(entry.id), owner: entry.owner, acreage: entry.acreage });
    }
    return matches;
  }

  // ── The confirm flow (one AOI query per click, reused — never re-queried on Confirm) ────

  private async handleFieldClick(
    e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
    method: 'clu' | 'parcel',
  ): Promise<void> {
    const tileFeature = e.features?.[0];
    if (!tileFeature) return;

    const tileProps = (tileFeature.properties ?? {}) as Record<string, unknown>;

    // G11: identity comes from the tile feature itself (native MVT id for CLU, parcel_id for
    // parcel) — never from point-lookup, whose CLU `id` is always the literal string "unknown".
    // Available immediately on click, no vendor round-trip required.
    const nativeId = method === 'clu' ? tileFeature.id : (tileProps['parcel_id'] as string | number | undefined);
    if (nativeId == null) {
      this.selectError.emit('Could not resolve an identifier for the clicked feature.');
      return;
    }
    const externalRef = method === 'clu' ? `clu:${nativeId}` : `parcel:${nativeId}`;

    // Pre-POST duplicate check (01-data-model.md) — immediate, before any vendor call, saving
    // both the point-lookup and AOI tokens on a hit.
    if (this.tags().some((t) => t.externalRef === externalRef)) {
      this.duplicateAttempted.emit(externalRef);
      return;
    }

    const landMapMagicKey = this.mapConfig().landMapMagicKey;
    if (!landMapMagicKey) {
      this.selectError.emit('LandMapMagic key is not configured.');
      return;
    }

    if (tileFeature.id != null) {
      this.setVendorSelected({ source: tileFeature.source, sourceLayer: tileFeature.sourceLayer, id: tileFeature.id });
    }

    // Show an immediate lightweight loading popup — the AOI retrieval below (~0.3-1s live) now
    // happens BEFORE the confirm popup appears, not after the user clicks "Confirm this field",
    // so the popup can be enriched with retrieved details (city/state, owner, top crop) the
    // originator can use to verify they've found the right producer's field before committing.
    this.activePopup?.remove();
    this.activePopup = this.showLoadingPopup(e.lngLat);

    await this.resolveAndShowFieldDetails(e.lngLat, tileFeature, tileProps, method, externalRef, nativeId, landMapMagicKey);
  }

  /**
   * Point-lookup + geometry resolution + ONE AOI query, then swaps the loading popup for either
   * the full details popup (success) or a retry-capable error popup (failure). Called once from
   * `handleFieldClick` and again, recursively, from the error popup's "Retry" button — retry
   * re-runs this exact function with the same closed-over click context, so it's indistinguishable
   * from the first attempt other than not re-doing the duplicate check (already passed).
   */
  private async resolveAndShowFieldDetails(
    lngLat: maplibregl.LngLatLike,
    tileFeature: maplibregl.MapGeoJSONFeature,
    tileProps: Record<string, unknown>,
    method: 'clu' | 'parcel',
    externalRef: string,
    nativeId: string | number,
    landMapMagicKey: string,
  ): Promise<void> {
    const lookupLayer = method === 'clu' ? 'clu' : 'parcels';
    let lookupField: LookupField | undefined;
    try {
      const results = await pointLookup((lngLat as maplibregl.LngLat).lat, (lngLat as maplibregl.LngLat).lng, landMapMagicKey);
      lookupField = results.find((f) => f.layer === lookupLayer) ?? results[0];
    } catch (err) {
      console.warn('[field-tag-map] Point Lookup failed; falling back to tile feature properties.', err);
    }

    const popupAcreage =
      lookupField?.acreage ?? this.toNumber(lookupLayer === 'parcels' ? tileProps['acreage_calc'] : tileProps['calcacres']);

    // A field spanning a tile boundary arrives as several disjoint fragments sharing a native id
    // (CLU: tile feature id; parcel: `parcel_id`); reconstruct the full field from every matching
    // fragment already loaded in the viewport before falling back to the single clicked fragment
    // (tile-seam reconstruction algorithm — see reconstructFullFieldGeometry below). Applies to
    // BOTH tiers: parcel tiles carry a real, stable `parcel_id` just like CLU carries a stable
    // native id, so the same grouping approach works — parcel previously had no reconstruction at
    // all and always persisted a clipped fragment for multi-tile parcels.
    const reconstructed = this.reconstructFullFieldGeometry(tileFeature, method);
    const sourceGeometry =
      reconstructed ??
      pickPolygonGeometry(lookupField?.feature.geometry as Geometry | undefined) ??
      pickPolygonGeometry(tileFeature.geometry as Geometry);

    if (!sourceGeometry) {
      this.activePopup?.remove();
      this.activePopup = this.showErrorPopup(
        lngLat,
        'Could not resolve a polygon geometry for the clicked feature.',
        null,
        () => this.setVendorSelected(null),
      );
      return;
    }

    const cdlYear = this.mapConfig().cdlYear;
    const cdlFallbackYear = this.mapConfig().cdlFallbackYear;

    try {
      // Exactly one AOI query per click (not per confirm — the confirm button below just emits
      // the already-built draft, no further vendor call). G9: parcel/drawn tiers never send
      // "parcels" as a layer — the live API rejects it; only CLU tier adds "clu" alongside
      // "cdl:<year>" (and, for all tiers, "states"/"counties" — see lmm-aoi-query.ts).
      //
      // CLU tier submits a PADDED bounding box, not sourceGeometry verbatim: the AOI endpoint
      // only returns features that geographically intersect the submitted polygon, and
      // sourceGeometry can be as small as a single tile-clipped fragment (when
      // reconstructFullFieldGeometry — which only sees currently-loaded tiles — comes up empty).
      // A sibling fragment sitting in the next tile over may not even touch that small shape, so
      // without padding it might never come back in the response at all (G10/G13). Parcel/drawn
      // don't need this: parcel never AOI-matches by geometry (G9), and drawn submits the whole
      // hand-drawn polygon already.
      const aoiGeometry = method === 'clu' ? paddedBoundingBoxPolygon(sourceGeometry, CLU_AOI_PADDING_METERS) : sourceGeometry;
      const result = await aoiQuery(toAoiFeature(aoiGeometry), method === 'clu', landMapMagicKey, cdlYear, cdlFallbackYear);

      // G10/G13 (confirmed against the live vendor API — see field-tag-map.component.ts module
      // comment / PR description for the verification data): the AOI response does NOT return one
      // authoritative, un-clipped polygon per physical field. Each row in `layers.clu.features` can
      // ITSELF still be a tile-clipped fragment — the vendor tiles its own response the same way
      // MVT tiles do. `calcacres` is a TRACT-level attribute inherited by every fragment of the
      // same field/FSA tract record, so multiple response rows legitimately share the exact same
      // calcacres while each covers only part of the true field (confirmed live: e.g. 4 fragments
      // all reporting calcacres=292.24, with individual feature_acres of ~116.53/~180.04/etc.
      // summing to ~296.57 — i.e. the true total, not the single tract attribute). So: collect
      // EVERY response feature within a tight calcacres tolerance of the clicked fragment (not
      // just the single closest one) and merge ALL of their geometries via real polygon union —
      // the same union-merge this component already does for client-loaded tile fragments
      // (reconstructFullFieldGeometry).
      const clickedCalcacres = this.toNumber(tileProps['calcacres']);
      let matchedGeometry: Polygon | MultiPolygon | null = null;
      let matchedAcres: number | null = null;
      if (method === 'clu' && clickedCalcacres != null) {
        const matches = result.features.filter((f) => {
          const props = f.properties as Record<string, unknown> | undefined;
          const candidateAcres = this.toNumber(props?.['calcacres'] ?? props?.['acres']);
          return candidateAcres != null && Math.abs(candidateAcres - clickedCalcacres) <= CLU_CALCACRES_TOLERANCE;
        });
        if (matches.length > 0) {
          matchedGeometry = this.unionMergeGeometries(matches.map((f) => f.geometry));
          if (matchedGeometry) {
            // Acreage from the MERGED polygon itself, not the raw tract-level calcacres attribute
            // (confirmed to drift a bit from true summed area — 292.24 vs ~296.57 in the example
            // above) and not a sum of feature_acres either: geometryAcres() keeps the persisted
            // acreage self-consistent with the persisted geometry — exactly how the drawn and
            // parcel tiers already compute calcAcres — so a later re-measurement of the saved
            // polygon (e.g. in a report, or by a person eyeballing the shape) always agrees with
            // the stored number. A real union should track the vendor's own summed feature_acres
            // closely (up to floating-point precision), unlike the old convex-hull merge, which
            // could overshoot it for concave fields.
            matchedAcres = round1(geometryAcres(matchedGeometry));
          }
        }
      }

      // Parcel has no vendor-authoritative fallback at all: the live API rejects "parcels" as an
      // AOI layer (G9), so client-side reconstruction (reconstructFullFieldGeometry) is the
      // ceiling for parcel geometry accuracy. If NO CLU fragments matched (e.g. calcacres missing,
      // or the vendor genuinely returned nothing overlapping even the padded AOI), fall back to
      // sourceGeometry — the pre-existing behavior — rather than regressing the no-match case.
      const geometry: Polygon | MultiPolygon = matchedGeometry ?? sourceGeometry;
      const calcAcres = matchedAcres ?? popupAcreage ?? round1(geometryAcres(geometry));

      const draft: FieldTagDraft = {
        selectionMethod: method,
        geometryJson: JSON.stringify(geometry),
        calcAcres,
        externalRef,
        cdlYear: result.cdlYear,
        cdlSnapshotJson: JSON.stringify(result.cropBreakdown),
      };

      // Owner comes from the "parcels" MVT source (client-side spatial match against whatever
      // parcel tiles are already loaded), never from CLU tiles (which carry no ownership field at
      // all) or the vendor API (Point Lookup never returns parcel data; AOI rejects "parcels" as a
      // layer entirely — see findOverlappingParcels). Works the same way for both tiers: for a
      // parcel-tier click this trivially rediscovers the exact clicked parcel (its tile is
      // definitely loaded, since that's what was clicked); for a CLU click it may find zero, one,
      // or (rarely) more than one overlapping parcel.
      const clickPoint: Position = [(lngLat as maplibregl.LngLat).lng, (lngLat as maplibregl.LngLat).lat];
      let parcelMatches = this.findOverlappingParcels({ point: clickPoint });
      if (method === 'parcel' && tileFeature.id != null && !parcelMatches.some((m) => m.id === tileFeature.id)) {
        parcelMatches = [
          {
            id: tileFeature.id,
            parcelId: String(tileFeature.id),
            owner: this.toDisplayString(tileProps['owner']),
            acreage: this.toNumber(tileProps['acreage_calc']),
          },
          ...parcelMatches,
        ];
      }
      const topCrop = this.topCrop(result.cropBreakdown);

      this.activePopup?.remove();
      this.activePopup = this.showFieldPopup(
        lngLat,
        { fieldId: String(nativeId), acreage: calcAcres, county: result.county, state: result.state, parcels: parcelMatches, topCrop },
        () => this.commitFieldConfirmed(draft),
      );
      // Stay in select mode — commitFieldConfirmed (on Confirm click) POSTs via the parent, which
      // appends to `tags` and flows back through the tags() effect for instant map feedback.
    } catch (err) {
      console.error('[field-tag-map] AOI Query failed:', err);
      this.activePopup?.remove();
      this.activePopup = this.showErrorPopup(
        lngLat,
        'Could not retrieve field details — check your connection and retry.',
        () => void this.resolveAndShowFieldDetails(lngLat, tileFeature, tileProps, method, externalRef, nativeId, landMapMagicKey),
        () => this.setVendorSelected(null),
      );
    }
  }

  /** Confirm button handler once details have already been retrieved — no further vendor call. */
  private commitFieldConfirmed(draft: FieldTagDraft): void {
    this.fieldConfirmed.emit(draft);
    this.setVendorSelected(null);
    this.activePopup?.remove();
    this.activePopup = null;
  }

  /**
   * Reconstruct a tile-boundary-spanning CLU or parcel field from every already-loaded tile
   * fragment sharing the clicked feature's native identity — CLU: the tile feature's NATIVE id
   * (not calcacres — live-tile verification found calcacres collides across genuinely distinct
   * fields within a tile; see G13 and 01-data-model.md "CLU identity: native MVT feature id");
   * parcel: the tile's `parcel_id` property, which is real and stable the same way (unlike CLU's
   * tile-local `id`, which required the G1 promoteId strip before it was trustworthy). Generalized
   * from the CLU-only `reconstructFullCluGeometry` — parcel previously had no reconstruction (and
   * no AOI-based correction, since the live API rejects "parcels" as an AOI layer, G9) so a
   * multi-tile parcel selection always persisted a clipped tile fragment. Uses
   * querySourceFeatures, which only sees tiles MapLibre has already fetched for the current
   * viewport — zero extra vendor tokens, but also means reconstruction can still undershoot if the
   * field extends beyond currently-loaded tiles; the sanity check below guards against persisting
   * a geometry missing whole fragments in that case.
   */
  private reconstructFullFieldGeometry(
    tileFeature: maplibregl.MapGeoJSONFeature,
    method: 'clu' | 'parcel',
  ): Polygon | MultiPolygon | null {
    const map = this.map;
    if (!map) return null;

    const tileProps = (tileFeature.properties ?? {}) as Record<string, unknown>;
    const sourceId = method === 'clu' ? 'clu' : 'parcels';
    const sourceLayer = method === 'clu' ? 'clu' : 'parcels';
    // Sanity-check acreage property differs per tier: CLU's is `calcacres`, parcel's real tile
    // attribute is `acreage_calc` (not `calcacres` — that's a CLU-only property).
    const sanityAcresProp = method === 'clu' ? 'calcacres' : 'acreage_calc';

    let filter: maplibregl.FilterSpecification;
    if (method === 'clu') {
      const nativeId = tileFeature.id;
      if (nativeId == null) return null;
      filter = ['==', ['id'], nativeId];
    } else {
      const parcelId = tileProps['parcel_id'];
      if (parcelId == null) return null;
      filter = ['==', ['get', 'parcel_id'], parcelId as string | number];
    }

    const fragments = map.querySourceFeatures(sourceId, { sourceLayer, filter });
    const polygon = this.unionMergeGeometries(fragments.map((f) => f.geometry as Geometry));
    if (!polygon) return null;
    const mergedAcres = geometryAcres(polygon);

    // The merged polygon is a real union of every currently-loaded fragment, so its area is exactly
    // the true area of what's present — no more, no less. A union meaningfully smaller than the
    // tile's own acreage attribute means fragments are missing (the field extends beyond
    // currently-loaded tiles), not that the merge geometry itself is wrong; the single-fragment
    // fallback is safer in that case. This property is a same-tile sanity cross-check only, never
    // the grouping key (G13).
    const sanityAcres = this.toNumber(tileProps[sanityAcresProp]);
    if (sanityAcres != null && mergedAcres < sanityAcres * 0.95) return null;

    return polygon;
  }

  /**
   * Union every matching fragment geometry in `geoms` into a single true (possibly concave)
   * boundary via `unionGeometries` (real polygon union — see geo.ts). Shared merge step behind
   * BOTH fragment-grouping paths in this component:
   * `reconstructFullFieldGeometry` (client tile-loaded fragments, grouped by native id/parcel_id)
   * and the AOI-response fragment merge in `confirmSelection` (grouped by matching calcacres,
   * G10/G13) — both are fundamentally "collect same-field fragments and union-merge them", just
   * sourced differently (already-loaded MVT tiles vs. one AOI response). Returns null if fewer
   * than one usable fragment geometry is available, or the union produces no output. May return a
   * `MultiPolygon` in the rare case where fragments don't perfectly touch due to floating-point
   * seams — see `unionGeometries` in geo.ts.
   */
  private unionMergeGeometries(geoms: (Geometry | null | undefined)[]): Polygon | MultiPolygon | null {
    const polys: (Polygon | MultiPolygon)[] = [];
    for (const geom of geoms) {
      const poly = pickPolygonGeometry(geom);
      if (poly) polys.push(poly);
    }
    if (polys.length === 0) return null;

    return unionGeometries(polys);
  }

  // ── Tier 4: draw your own boundary ───────────────────────────────────────

  private async onPolygonDrawn(feature: Feature<Polygon>): Promise<void> {
    // Store the winding-normalized geometry (RFC 7946) rather than the raw drawn ring — the AOI
    // request and the ExternalRef hash already normalize independently; the persisted artifact
    // must match.
    const geometry = normalizeWinding(feature.geometry) as Polygon;
    const acreage = round1(geometryAcres(geometry));
    const externalRef = await drawnExternalRef(geometry);

    const bounds = new maplibregl.LngLatBounds();
    for (const pos of this.iterateCoordinates(geometry)) bounds.extend(pos as [number, number]);
    const anchor = bounds.getCenter();

    // Popup-gated, like the CLU/parcel click flow — the draw controller's cyan overlay stays on
    // the map until the user actually confirms or discards (see showDrawConfirmPopup); it no
    // longer auto-creates the field the instant the polygon is finished.
    this.activePopup?.remove();
    this.activePopup = this.showLoadingPopup(anchor);

    // A drawn polygon can span multiple parcels — that's the whole reason Tier 4 exists, to
    // capture a field that doesn't line up with any single CLU/parcel boundary. Find every
    // already-loaded parcel overlapping it client-side (generalized from findOverlappingParcels'
    // point test to its polygon-intersection test) — there is no vendor-API equivalent (AOI
    // rejects "parcels" as a layer entirely, G9).
    const parcelMatches = this.findOverlappingParcels({ polygon: geometry });

    const landMapMagicKey = this.mapConfig().landMapMagicKey;
    const cdlYear = this.mapConfig().cdlYear;
    const cdlFallbackYear = this.mapConfig().cdlFallbackYear;

    // Drawn tiles skip the client dup check entirely — the hash of a hand-drawn polygon is
    // unique in practice (01-data-model.md).
    let cropBreakdown: CropBreakdownEntry[] = [];
    let resolvedCdlYear: string | null = null;
    let county: string | null = null;
    let state: string | null = null;
    if (landMapMagicKey) {
      try {
        // CDL + states/counties enrichment only — never "clu"/"parcels" for a drawn AOI (G9).
        // Tolerate failure: the popup still offers to confirm with an empty crop breakdown and no
        // county/state, matching this tier's existing resilience (a vendor hiccup here has never
        // blocked persisting a drawn field, only degraded its enrichment).
        const result = await aoiQuery(toAoiFeature(geometry), false, landMapMagicKey, cdlYear, cdlFallbackYear);
        cropBreakdown = result.cropBreakdown;
        resolvedCdlYear = result.cdlYear;
        county = result.county;
        state = result.state;
      } catch (err) {
        console.warn('[field-tag-map] CDL enrichment for drawn polygon failed (still offering to confirm):', err);
      }
    }

    const draft: FieldTagDraft = {
      selectionMethod: 'drawn',
      geometryJson: JSON.stringify(geometry),
      calcAcres: acreage,
      externalRef,
      cdlYear: resolvedCdlYear,
      cdlSnapshotJson: JSON.stringify(cropBreakdown),
    };
    const topCrop = this.topCrop(cropBreakdown);

    this.activePopup?.remove();
    this.activePopup = this.showDrawConfirmPopup(
      anchor,
      { acreage, county, state, parcels: parcelMatches, topCrop },
      () => {
        this.fieldConfirmed.emit(draft);
        this.activePopup?.remove();
        this.activePopup = null;
      },
      () => this.drawController?.rearm(),
    );
  }

  // ── Popups (manual DOM — never setHTML with vendor-supplied strings) ────
  //
  // MapLibre's `.maplibregl-popup-content` box is ALWAYS a plain white background (from
  // maplibre-gl.css, never overridden for dark mode — confirmed: no app stylesheet touches any
  // `.maplibregl-popup*` class). Popup content below therefore uses fixed, non-dark-mode-
  // conditional colors chosen for contrast against that guaranteed-white box — the previous
  // `dark:text-gray-100`/`dark:text-gray-300` classes rendered near-white text on that same white
  // background whenever the app was in dark mode, which is what made the popup unreadable.

  private popupContainer(minWidthClass = 'min-w-[200px]'): HTMLDivElement {
    const container = document.createElement('div');
    container.className = `text-sm text-gray-900 ${minWidthClass}`;
    return container;
  }

  private appendRow(rows: HTMLElement, label: string, value: string): void {
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

  /**
   * Owner/parcel list section, shared by the click-based and draw-based confirm popups. Each
   * parcel is its OWN row — never deduplicated by owner name, so a polygon spanning two parcels
   * owned by the same person still shows two rows (per the explicit requirement that same-owner
   * multi-parcel spans still count as "multiple owners" for display purposes). Hovering a row
   * highlights that parcel's boundary via `setPopupHighlight` (the always-on
   * `parcels-popup-highlight` layer), regardless of the current tier.
   */
  private appendParcelsSection(container: HTMLElement, parcels: ParcelOwnerMatch[]): void {
    const section = document.createElement('div');
    section.className = 'mb-3';

    const heading = document.createElement('div');
    heading.className = 'text-gray-500 text-xs uppercase tracking-wide mb-1';
    heading.textContent =
      parcels.length === 0
        ? 'Owner'
        : parcels.length === 1
          ? 'Owner'
          : `Owners — ${parcels.length} parcels`;
    section.append(heading);

    if (parcels.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'text-gray-500 italic';
      empty.textContent = 'Not available in currently loaded map data';
      section.append(empty);
      container.append(section);
      return;
    }

    const list = document.createElement('div');
    list.className = 'space-y-0.5 max-h-32 overflow-y-auto';
    for (const p of parcels) {
      const row = document.createElement('div');
      row.className = 'text-gray-900 font-medium rounded px-1 -mx-1 py-0.5 hover:bg-orange-50 cursor-default';
      row.textContent = p.owner ?? `Parcel ${p.parcelId} (owner unavailable)`;
      row.addEventListener('mouseenter', () => this.setPopupHighlight({ source: 'parcels', sourceLayer: 'parcels', id: p.id }));
      row.addEventListener('mouseleave', () => this.setPopupHighlight(null));
      list.append(row);
    }
    section.append(list);
    container.append(section);
  }

  /** Shown immediately on click while point-lookup + the AOI retrieval are in flight. */
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

  /**
   * Shown once point-lookup + the single AOI retrieval have both resolved. Confirm just emits the
   * already-built draft (no vendor call happens on click — see commitFieldConfirmed).
   */
  private showFieldPopup(
    lngLat: maplibregl.LngLatLike,
    info: {
      fieldId: string;
      acreage: number | null;
      county: string | null;
      state: string | null;
      parcels: ParcelOwnerMatch[];
      topCrop: { name: string; pct: number } | null;
    },
    onConfirm: () => void,
  ): maplibregl.Popup {
    const map = this.map!;
    const container = this.popupContainer();

    const idEl = document.createElement('div');
    idEl.className = 'font-semibold text-base text-gray-900 mb-1.5';
    idEl.textContent = `Field ${info.fieldId}`;
    container.append(idEl);

    const rows = document.createElement('div');
    rows.className = 'space-y-1 mb-3';
    this.appendRow(rows, 'Acres', info.acreage != null ? info.acreage.toFixed(1) : 'Unavailable');
    if (info.county || info.state) {
      this.appendRow(rows, 'Location', [info.county, info.state].filter((v): v is string => !!v).join(', '));
    }
    if (info.topCrop) {
      this.appendRow(rows, 'Top crop', `${info.topCrop.name} (${Math.round(info.topCrop.pct)}%)`);
    }
    container.append(rows);

    this.appendParcelsSection(container, info.parcels);

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'w-full rounded-md bg-green-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-green-700';
    confirmBtn.textContent = 'Confirm this field';
    container.append(confirmBtn);

    // `closeButton: true` gives the popup MapLibre's own small top-right "X" — that's the only
    // dismiss affordance now (no separate Cancel button); the vendor `selected` feature-state is
    // intentionally left lit on dismiss (it clears on the next feature click or on leaving select
    // mode via exitSelectMode, not here — wiring cleanup to the popup's 'close' event would also
    // fire on our OWN programmatic .remove() calls when swapping popups for a newly clicked
    // feature, which would wipe out that feature's just-set selection out from under it).
    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px' }).setLngLat(lngLat).setDOMContent(container).addTo(map);

    confirmBtn.addEventListener('click', () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Saving…';
      onConfirm();
    });
    popup.on('close', () => this.setPopupHighlight(null));

    return popup;
  }

  /**
   * Draw-tier (Tier 4) confirm popup — a discarded hand-drawn polygon leaves a real half-formed
   * overlay on the map (mapbox-gl-draw's own rendered shape), so the native "X" close button is
   * the discard affordance: closing the popup any way clears it (see the 'close' handler below).
   */
  private showDrawConfirmPopup(
    lngLat: maplibregl.LngLatLike,
    info: {
      acreage: number;
      county: string | null;
      state: string | null;
      parcels: ParcelOwnerMatch[];
      topCrop: { name: string; pct: number } | null;
    },
    onConfirm: () => void,
    onDiscard: () => void,
  ): maplibregl.Popup {
    const map = this.map!;
    const container = this.popupContainer();

    const idEl = document.createElement('div');
    idEl.className = 'font-semibold text-base text-gray-900 mb-1.5';
    idEl.textContent = 'Drawn field';
    container.append(idEl);

    const rows = document.createElement('div');
    rows.className = 'space-y-1 mb-3';
    this.appendRow(rows, 'Acres', info.acreage.toFixed(1));
    if (info.county || info.state) {
      this.appendRow(rows, 'Location', [info.county, info.state].filter((v): v is string => !!v).join(', '));
    }
    if (info.topCrop) {
      this.appendRow(rows, 'Top crop', `${info.topCrop.name} (${Math.round(info.topCrop.pct)}%)`);
    }
    container.append(rows);

    this.appendParcelsSection(container, info.parcels);

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'w-full rounded-md bg-green-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-green-700';
    confirmBtn.textContent = 'Confirm this field';
    container.append(confirmBtn);

    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px' }).setLngLat(lngLat).setDOMContent(container).addTo(map);

    confirmBtn.addEventListener('click', () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Saving…';
      onConfirm();
    });
    // Wired to 'close' rather than the button: fires no matter HOW the popup closes — the native
    // "X", or Confirm's own `.remove()` call — so cleanup (clearing the popup-highlight +
    // re-arming the draw controller) always happens exactly once, in one place. Re-arming after a
    // SUCCESSFUL confirm is exactly the old rearm-after-confirm behavior; after the "X" it clears
    // the half-drawn polygon so the user isn't stranded with an uncommittable
    // shape (unlike the click-based popup, a drawn polygon is a real overlay left on the map, so
    // this popup — unlike that one — DOES need every dismiss path to clean it up).
    popup.on('close', () => {
      this.setPopupHighlight(null);
      onDiscard();
    });

    return popup;
  }

  /** Shown when the AOI retrieval itself fails; Retry re-runs the same request. */
  private showErrorPopup(
    lngLat: maplibregl.LngLatLike,
    message: string,
    onRetry: (() => void) | null,
    onCancel: () => void,
  ): maplibregl.Popup {
    const map = this.map!;
    const container = this.popupContainer('min-w-[180px]');

    const msgEl = document.createElement('div');
    msgEl.className = 'text-red-700 mb-2';
    msgEl.textContent = message;
    container.append(msgEl);

    if (onRetry) {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'w-full rounded-md bg-gray-700 text-white px-3 py-1.5 text-sm font-medium hover:bg-gray-800';
      retryBtn.textContent = 'Retry';
      container.append(retryBtn);
      retryBtn.addEventListener('click', () => {
        retryBtn.disabled = true;
        retryBtn.textContent = 'Retrying…';
        onRetry();
      });
    }

    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' }).setLngLat(lngLat).setDOMContent(container).addTo(map);
    popup.on('close', onCancel);

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
  private topCrop(
    breakdown: ReadonlyArray<{ crop: string; percentOfAoi: number | null }>,
  ): { name: string; pct: number } | null {
    let best: { crop: string; percentOfAoi: number } | null = null;
    for (const entry of breakdown) {
      if (entry.percentOfAoi == null) continue;
      if (!best || entry.percentOfAoi > best.percentOfAoi) best = { crop: entry.crop, percentOfAoi: entry.percentOfAoi };
    }
    return best ? { name: best.crop, pct: best.percentOfAoi } : null;
  }
}
