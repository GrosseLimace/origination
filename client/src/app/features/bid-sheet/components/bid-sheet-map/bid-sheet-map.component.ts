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
import { BidSheetLocation } from '@models';
import { BidSheetMapRenderModel, BidSheetMapRenderGroup } from './bid-sheet-map.model';

/**
 * BidSheetMapComponent — MapLibre GL rendering path for the Bid Sheet map.
 * See docs/poc/bid-sheet-map/03-frontend-components.md for the full design this ports from
 * `field-tag-map.component.ts` (basemap init/lifecycle pattern) and from
 * `bid-sheet.component.ts`'s existing (still-present) Leaflet path (marker rendering/camera logic).
 *
 * This build-order step ports basemap + marker rendering + camera/add-location only — no
 * CLU/Parcel view, JIT field-context lookup, fullscreen, or address search (later steps).
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

  readonly azureMapsKey = input.required<string>();

  // ── Outputs ───────────────────────────────────────────────────────────────
  readonly locationSelected = output<BidSheetLocation>();
  readonly mapClicked = output<{ lat: number; lng: number }>();
  readonly zoomChanged = output<number>();

  // ── Template-facing state (basemap toggle / loading overlay) ────────────
  readonly basemapStyle = signal<BasemapStyle>('street'); // street-first default, matching Leaflet
  readonly switching = signal(false);

  private map: maplibregl.Map | null = null;
  private readonly loaded = signal(false);
  private resizeObserver: ResizeObserver | null = null;
  private renderedMarkers: RenderedMarker[] = [];
  private addLocationMarker: maplibregl.Marker | null = null;
  private hoveredMarker: RenderedMarker | null = null;
  private zoomDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    afterNextRender(() => this.initMap());
    this.destroyRef.onDestroy(() => {
      if (this.zoomDebounceTimer) clearTimeout(this.zoomDebounceTimer);
      this.resizeObserver?.disconnect();
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
    effect(() => {
      const mode = this.addLocationMode();
      if (!this.loaded()) return;
      if (!mode) {
        this.addLocationMarker?.remove();
        this.addLocationMarker = null;
      }
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

    contentEl.addEventListener('click', () => {
      const name = g.names[0];
      const loc = this.locations().find((l) => l.name === name);
      if (loc) this.locationSelected.emit(loc);
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
