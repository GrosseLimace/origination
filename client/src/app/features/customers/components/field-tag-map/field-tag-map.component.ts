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
} from '../../services/field-tagging/lmm-styles.service';
import { pointLookup, type LookupField } from '../../services/field-tagging/lmm-point-lookup';
import { aoiQuery } from '../../services/field-tagging/lmm-aoi-query';
import { setupDraw, type DrawController } from '../../services/field-tagging/draw-setup';
import {
  geometryAcres,
  toAoiFeature,
  convexHull,
  pickPolygonGeometry,
  round1,
  drawnExternalRef,
  normalizeWinding,
} from '../../services/field-tagging/geo';

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

const AZURE_SOURCE_ID = 'azure-imagery';
const TAGGED_SOURCE_ID = 'tagged-fields';
const TAGGED_FILL_LAYER_ID = 'tagged-fields-fill';
const TAGGED_OUTLINE_LAYER_ID = 'tagged-fields-outline';
const TAGGED_OUTLINE_DASHED_LAYER_ID = 'tagged-fields-outline-dashed';

const DEFAULT_CENTER: [number, number] = [-98.5795, 39.8283]; // CONUS geographic center
const DEFAULT_ZOOM = 4;
const REVIEW_ZOOM_NO_TAGS = 13;
const SELECT_MODE_ZOOM = 15; // G12: CLU tiles only render at zoom >= 12; 15 lands comfortably inside range

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

  // ── Outputs ───────────────────────────────────────────────────────────────
  readonly tagHover = output<number | null>();
  readonly fieldConfirmed = output<FieldTagDraft>();
  readonly duplicateAttempted = output<string>();
  readonly selectError = output<string>();

  // ── Template-facing state (tier selector / legend) ──────────────────────
  readonly currentTier = signal<Tier>('clu');
  readonly tierHint = signal<string>('');
  readonly methodStyle = FIELD_TAG_METHOD_STYLE;
  readonly isSelectMode = signal(false);

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
      setLayerGroupVisibility(map, this.lmmLayers.clu, tier === 'clu');
      setLayerGroupVisibility(map, this.lmmLayers.parcels, tier === 'parcel');
    }
  }

  // ── Map bootstrap ─────────────────────────────────────────────────────────

  private initMap(): void {
    const container = this.mapContainerRef.nativeElement;
    const azureKey = this.mapConfig().azureMapsKey ?? '';
    const tileUrl =
      'https://atlas.microsoft.com/map/tile?api-version=2.0&tilesetId=microsoft.imagery' +
      `&zoom={z}&x={x}&y={y}&subscription-key=${azureKey}`;

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
          [AZURE_SOURCE_ID]: {
            type: 'raster',
            tiles: [tileUrl],
            tileSize: 256,
            attribution: '© Microsoft — Azure Maps',
          },
        },
        layers: [{ id: AZURE_SOURCE_ID, type: 'raster', source: AZURE_SOURCE_ID }],
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

    const coords = this.customer().coordinates;
    if (coords) {
      map.flyTo({ center: [coords.lng, coords.lat], zoom: SELECT_MODE_ZOOM });
    }

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

  // ── The confirm flow (one AOI query per confirm) ─────────────────────────

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
    const nativeId = method === 'clu' ? tileFeature.id : tileProps['parcel_id'];
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

    const lookupLayer = method === 'clu' ? 'clu' : 'parcels';
    let lookupField: LookupField | undefined;
    try {
      const results = await pointLookup(e.lngLat.lat, e.lngLat.lng, landMapMagicKey);
      lookupField = results.find((f) => f.layer === lookupLayer) ?? results[0];
    } catch (err) {
      console.warn('[field-tag-map] Point Lookup failed; falling back to tile feature properties.', err);
    }

    const acreage =
      lookupField?.acreage ?? this.toNumber(lookupLayer === 'parcels' ? tileProps['acreage_calc'] : tileProps['calcacres']);

    if (tileFeature.id != null) {
      this.setVendorSelected({ source: tileFeature.source, sourceLayer: tileFeature.sourceLayer, id: tileFeature.id });
    }

    this.activePopup?.remove();
    this.activePopup = this.showFieldPopup(
      e.lngLat,
      { fieldId: String(nativeId), acreage },
      (resetButton) => void this.confirmSelection(method, externalRef, acreage, lookupField, tileFeature, resetButton),
      () => this.setVendorSelected(null),
    );
  }

  private async confirmSelection(
    method: 'clu' | 'parcel',
    externalRef: string,
    popupAcreage: number | null,
    lookupField: LookupField | undefined,
    tileFeature: maplibregl.MapGeoJSONFeature,
    resetButton: () => void,
  ): Promise<void> {
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
      this.selectError.emit('Could not resolve a polygon geometry for the clicked feature.');
      resetButton();
      return;
    }

    const landMapMagicKey = this.mapConfig().landMapMagicKey;
    if (!landMapMagicKey) {
      this.selectError.emit('LandMapMagic key is not configured.');
      resetButton();
      return;
    }
    const cdlYear = this.mapConfig().cdlYear;
    const cdlFallbackYear = this.mapConfig().cdlFallbackYear;

    try {
      // Exactly one AOI query per confirm. G9: parcel/drawn tiers never send "parcels" as a
      // layer — the live API rejects it; only CLU tier adds "clu" alongside "cdl:<year>".
      const result = await aoiQuery(toAoiFeature(sourceGeometry), method === 'clu', landMapMagicKey, cdlYear, cdlFallbackYear);

      // G10: match the response's CLU feature back to the clicked field by calcacres — never
      // features[0] (the reconstructed AOI can clip neighbors and response order isn't guaranteed).
      // Tolerant comparison, not strict `===`: clickedCalcacres (tile-server attribute) and the
      // AOI response's calcacres/acres (a separately-computed vendor value) can differ by rounding
      // for the SAME field, which previously caused strict equality to silently miss the correct
      // match and fall back to the (possibly tile-clipped) sourceGeometry. Tolerance is the larger
      // of a fixed 0.5-acre floor (covers small fields where 1% is too tight) and 1% of the
      // clicked acreage (covers large fields where rounding drift exceeds 0.5 ac in absolute
      // terms). When multiple candidates fall within tolerance, prefer the closest.
      const clickedCalcacres = this.toNumber((tileFeature.properties as Record<string, unknown> | undefined)?.['calcacres']);
      let responseFeature: (typeof result.features)[number] | undefined;
      if (method === 'clu' && clickedCalcacres != null) {
        const tolerance = Math.max(0.5, clickedCalcacres * 0.01);
        let bestDiff = Infinity;
        for (const f of result.features) {
          const props = f.properties as Record<string, unknown> | undefined;
          const candidateAcres = this.toNumber(props?.['calcacres'] ?? props?.['acres']);
          if (candidateAcres == null) continue;
          const diff = Math.abs(candidateAcres - clickedCalcacres);
          if (diff <= tolerance && diff < bestDiff) {
            bestDiff = diff;
            responseFeature = f;
          }
        }
      }

      // The vendor's own AOI-response geometry is authoritative and not limited by which tiles
      // MapLibre happened to have loaded client-side (unlike the querySourceFeatures-based hull
      // above) — so prefer it over the client reconstruction whenever a confident match exists.
      // Parcel has no equivalent: the live API rejects "parcels" as an AOI layer (G9), so
      // client-side reconstruction (reconstructFullFieldGeometry) is the ceiling for parcel
      // geometry accuracy — there is no vendor-authoritative fallback to correct an undershoot.
      const matchedGeometry = responseFeature ? pickPolygonGeometry(responseFeature.geometry) : null;
      const geometry: Polygon | MultiPolygon = matchedGeometry ?? sourceGeometry;

      const responseAcres = this.toNumber(
        (responseFeature?.properties as Record<string, unknown> | undefined)?.['calcacres'] ??
          (responseFeature?.properties as Record<string, unknown> | undefined)?.['acres'],
      );
      const calcAcres = responseAcres ?? popupAcreage ?? round1(geometryAcres(geometry));

      const draft: FieldTagDraft = {
        selectionMethod: method,
        geometryJson: JSON.stringify(geometry),
        calcAcres,
        externalRef,
        cdlYear: result.cdlYear,
        cdlSnapshotJson: JSON.stringify(result.cropBreakdown),
      };

      this.fieldConfirmed.emit(draft);
      this.setVendorSelected(null);
      this.activePopup?.remove();
      this.activePopup = null;
      // Stay in select mode — the parent POSTs the draft and appends to `tags`, which flows back
      // through the tags() effect and re-`setData`s the tagged-fields source for instant feedback.
    } catch (err) {
      console.error('[field-tag-map] AOI Query failed:', err);
      this.selectError.emit('AOI Query failed — could not capture field geometry/crop history.');
      // Re-enable the Confirm button and restore its label rather than leaving the popup stuck
      // at "Capturing…" — the user can retry directly from the popup (re-running only the 10-token
      // AOI call, no extra point-lookup) instead of having to close the popup and re-click the map.
      // The vendor `selected` feature-state is intentionally left lit so the retry targets the same
      // clicked feature.
      resetButton();
    }
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
   * a bad hull in that case.
   */
  private reconstructFullFieldGeometry(
    tileFeature: maplibregl.MapGeoJSONFeature,
    method: 'clu' | 'parcel',
  ): Polygon | null {
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

    const points: Position[] = [];
    for (const frag of fragments) {
      const geom = pickPolygonGeometry(frag.geometry as Geometry);
      if (!geom) continue;
      const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
      for (const ring of rings) points.push(...ring);
    }
    if (points.length < 3) return null;

    const hull = convexHull(points);
    if (hull.length < 3) return null;

    const polygon: Polygon = { type: 'Polygon', coordinates: [[...hull, hull[0]]] };
    const hullAcres = geometryAcres(polygon);

    // A convex hull of a concave true boundary can only overshoot, never meaningfully undershoot —
    // a hull smaller than the tile's own acreage attribute suggests something went wrong (e.g. the
    // field extends beyond currently-loaded tiles); the single-fragment fallback is safer. This
    // property is a same-tile sanity cross-check only, never the grouping key (G13).
    const sanityAcres = this.toNumber(tileProps[sanityAcresProp]);
    if (sanityAcres != null && hullAcres < sanityAcres * 0.95) return null;

    return polygon;
  }

  // ── Tier 4: draw your own boundary ───────────────────────────────────────

  private async onPolygonDrawn(feature: Feature<Polygon>): Promise<void> {
    // Store the winding-normalized geometry (RFC 7946) rather than the raw drawn ring — the AOI
    // request and the ExternalRef hash already normalize independently; the persisted artifact
    // must match.
    const geometry = normalizeWinding(feature.geometry) as Polygon;
    const acreage = round1(geometryAcres(geometry));
    const externalRef = await drawnExternalRef(geometry);

    const landMapMagicKey = this.mapConfig().landMapMagicKey;
    const cdlYear = this.mapConfig().cdlYear;
    const cdlFallbackYear = this.mapConfig().cdlFallbackYear;

    // Drawn tiles skip the client dup check entirely — the hash of a hand-drawn polygon is
    // unique in practice (01-data-model.md).
    let cropBreakdown: CropBreakdownEntry[] = [];
    let resolvedCdlYear: string | null = null;
    if (landMapMagicKey) {
      try {
        // CDL enrichment only — never "clu"/"parcels" for a drawn AOI (G9). Tolerate failure:
        // the tag still confirms with an empty breakdown and a null cdlYear.
        const result = await aoiQuery(toAoiFeature(geometry), false, landMapMagicKey, cdlYear, cdlFallbackYear);
        cropBreakdown = result.cropBreakdown;
        resolvedCdlYear = result.cdlYear;
      } catch (err) {
        console.warn('[field-tag-map] CDL enrichment for drawn polygon failed (tag still confirmed):', err);
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

    this.fieldConfirmed.emit(draft);

    // Clear the mapbox-gl-draw plugin's rendered polygon and re-arm draw mode so the cyan drawn
    // shape doesn't linger/double-render alongside the newly saved amber dashed tag, and so the
    // user can draw the next field without re-clicking "Tier 4 — Draw your own".
    this.drawController?.rearm();
  }

  // ── Popup (manual DOM — never setHTML with vendor-supplied strings) ─────

  private showFieldPopup(
    lngLat: maplibregl.LngLatLike,
    info: { fieldId: string; acreage: number | null },
    onConfirm: (resetButton: () => void) => void,
    onNotRight: () => void,
  ): maplibregl.Popup {
    const map = this.map!;
    const container = document.createElement('div');
    container.className = 'text-sm';

    const idEl = document.createElement('div');
    idEl.className = 'font-medium text-gray-900 dark:text-gray-100';
    idEl.textContent = `Field ${info.fieldId}`;

    const acresEl = document.createElement('div');
    acresEl.className = 'text-gray-600 dark:text-gray-300 mb-2';
    acresEl.textContent = info.acreage != null ? `${info.acreage.toFixed(1)} acres` : 'Acreage unavailable';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'rounded-md bg-green-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-green-700';
    confirmBtn.textContent = 'Confirm this field';

    const notRight = document.createElement('a');
    notRight.href = '#';
    notRight.className = 'block mt-2 text-xs text-gray-500 hover:underline';
    notRight.textContent = "This isn't right — try Parcel or Draw instead";

    container.append(idEl, acresEl, confirmBtn, notRight);

    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' }).setLngLat(lngLat).setDOMContent(container).addTo(map);

    const confirmBtnDefaultText = confirmBtn.textContent ?? 'Confirm this field';
    confirmBtn.addEventListener('click', () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Capturing…';
      onConfirm(() => {
        confirmBtn.disabled = false;
        confirmBtn.textContent = confirmBtnDefaultText;
      });
    });
    notRight.addEventListener('click', (ev) => {
      ev.preventDefault();
      popup.remove();
      onNotRight();
    });

    return popup;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private toNumber(value: unknown): number | null {
    const n = Number(value);
    return value != null && Number.isFinite(n) ? n : null;
  }
}
