// Shared color/pattern key for rendering a CustomerFieldTag by its SelectionMethod — imported by
// both FieldTagMapComponent (map fill/outline paint + legend) and the future FieldTagListComponent
// (row source badge), so a user can correlate a list row to its map polygon by color without
// re-learning the mapping per surface. See docs/maps/field-tagging/03-frontend-map-component.md
// "Rendering by selection method (CLU / Parcel / Drawn)".

import type { SelectionMethod } from '@models';

export interface FieldTagMethodStyle {
  label: string;
  /** Hex color used directly in MapLibre paint expressions. */
  color: string;
  /** Tailwind chip classes for the list's source badge (light + dark). */
  badgeClass: string;
  /** True for methods rendered with a dashed outline on the map (currently just `drawn`). */
  dashed: boolean;
}

export const FIELD_TAG_METHOD_STYLE: Record<SelectionMethod, FieldTagMethodStyle> = {
  clu: {
    label: 'CLU',
    color: '#16a34a', // green-600
    badgeClass: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    dashed: false,
  },
  parcel: {
    label: 'Parcel',
    color: '#2563eb', // blue-600
    badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    dashed: false,
  },
  drawn: {
    label: 'Drawn',
    color: '#d97706', // amber-600
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    dashed: true,
  },
};

export const FIELD_TAG_METHOD_FALLBACK_COLOR = '#6b7280'; // gray-500, unrecognized sourceMethod
