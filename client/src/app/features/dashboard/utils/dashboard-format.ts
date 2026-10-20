import { Customer } from '@models';

/**
 * Display formatting for the planting dashboard. Moved out of DashboardComponent unchanged; the
 * template still calls these through the component.
 */

/** Compact acre label for chart axes: 1.2M, 340K, or the plain number below a thousand. */
export function formatAcres(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return n.toString();
}

/** Same as formatAcres, except zero reads as "--" (no figure rather than a real zero). */
export function formatK(n: number): string {
  if (n === 0) return '--';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return n.toString();
}

export function getInitials(name: string): string {
  const parts = name.split(' ').filter(p => p.length > 0);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  if (parts.length === 1 && parts[0].length >= 2) return parts[0].substring(0, 2).toUpperCase();
  return '??';
}

export function getFormattedLocation(customer: Customer | undefined): string {
  if (!customer) return '';
  if (customer.extendedCity && customer.extendedStateProvince) {
    return `${customer.extendedCity}, ${customer.extendedStateProvince}`;
  }
  if (customer.location && customer.stateProvince) {
    return `${customer.location}, ${customer.stateProvince}`;
  }
  return customer.extendedCity || customer.location || customer.stateProvince || '';
}

/**
 * Convert any-case input to Title Case: "WHEAT" → "Wheat",
 * "hard red winter wheat" → "Hard Red Winter Wheat", "Co-Product" → "Co-Product".
 * Word boundaries are preserved so hyphenated and multi-word strings stay readable.
 */
export function toTitleCase(s: string): string {
  if (!s) return s;
  return s.toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase());
}

/**
 * Crop key/label for the dashboard from a planting intention: planting type + label
 * (e.g. "Irrigated Corn", "Double Crop Corn"). Double Crop is just a type now, so it splits
 * out like Irrigated / Dryland — including in Season Targets.
 */
export function dashboardCropKey(type: string | undefined, label: string): string {
  return [type, label].filter(Boolean).join(' ');
}
