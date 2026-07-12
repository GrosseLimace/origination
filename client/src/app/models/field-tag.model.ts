/**
 * Field Tagging POC models — see docs/maps/field-tagging/01-data-model.md and
 * 02-backend-api.md for the authoritative shapes these mirror.
 */

/** How a tagged field's boundary was captured. Matches lcfs-poc's `SelectionMethod`. */
export type SelectionMethod = 'clu' | 'parcel' | 'drawn';

/** Single crop-breakdown row from a CDL (Cropland Data Layer) AOI query, stored verbatim. */
export interface CropBreakdownEntry {
  code: string;
  crop: string;
  intersectionAcres: number;
  percentOfAoi: number | null;
}

/**
 * A saved field tag as returned by `GET /api/customers/{customerId}/field-tags`
 * (`FieldTagResponse` in 02-backend-api.md).
 */
export interface CustomerFieldTag {
  id: number;
  customerId: number;
  selectionMethod: SelectionMethod;
  /** GeoJSON Polygon/MultiPolygon geometry (not a Feature) as stored — parse before rendering. */
  geometryJson: string;
  calcAcres: number | null;
  /** Dedup key — `clu:<nativeId>` | `parcel:<parcelId>` | `drawn:<sha256>`. */
  externalRef: string;
  cdlYear: string | null;
  /** Serialized `CropBreakdownEntry[]` — parse before rendering. */
  cdlSnapshotJson: string | null;
  createdBy: string;
  createdAt: string;
  modifiedBy: string | null;
  modifiedAt: string | null;
}

/**
 * Draft emitted by `FieldTagMapComponent` on `fieldConfirmed` — exactly the shape of
 * `CreateFieldTagRequest` (02-backend-api.md), for the parent to POST.
 */
export interface FieldTagDraft {
  selectionMethod: SelectionMethod;
  geometryJson: string;
  calcAcres: number | null;
  externalRef: string;
  cdlYear: string | null;
  cdlSnapshotJson: string | null;
}

/** Response from `POST /api/customers/{customerId}/field-tags/apply-calculated-acres`. */
export interface ApplyCalculatedAcresResponse {
  customerId: number;
  totalAcres: number;
  tagCount: number;
}

/**
 * Response from `GET /api/field-tag-config` — the SPA's runtime map configuration.
 * Keys are null when the feature is dormant (`enabled: false`).
 */
export interface FieldTagMapConfig {
  enabled: boolean;
  azureMapsKey: string | null;
  landMapMagicKey: string | null;
  cdlYear: string;
  cdlFallbackYear: string;
}

// ── Client-side derived helpers (04-frontend-list-and-hover-sync.md) ───────
// Plain functions, not on the interface, so `CustomerFieldTag` stays a pure server-shape mirror.

/** Parses `tag.geometryJson` into a GeoJSON geometry, or null if malformed. */
export function parseGeometry(tag: CustomerFieldTag): unknown | null {
  try {
    return JSON.parse(tag.geometryJson);
  } catch {
    return null;
  }
}

/** Parses `tag.cdlSnapshotJson` into its crop breakdown array, or [] if null/malformed. */
export function parseCdlSnapshot(tag: CustomerFieldTag): CropBreakdownEntry[] {
  if (!tag.cdlSnapshotJson) return [];
  try {
    const parsed = JSON.parse(tag.cdlSnapshotJson);
    return Array.isArray(parsed) ? (parsed as CropBreakdownEntry[]) : [];
  } catch {
    return [];
  }
}

/** The dominant crop in a tag's CDL snapshot — the max `intersectionAcres` entry, or null. */
export function topCrop(tag: CustomerFieldTag): CropBreakdownEntry | null {
  const entries = parseCdlSnapshot(tag);
  if (entries.length === 0) return null;
  return entries.reduce((max, entry) => (entry.intersectionAcres > max.intersectionAcres ? entry : max));
}
