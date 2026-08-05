/**
 * Formatting shared by the usage dashboard and its per-user drill-down. These lived duplicated in
 * both components; the timestamp and date helpers in particular had drifted apart.
 */

/**
 * `yyyy-MM-dd` for the date as the user sees it locally.
 *
 * `toISOString()` would convert to UTC first, so any time after ~18:00 US Central reports
 * tomorrow's date — the dashboard would ask for a window a day ahead of what the user picked.
 */
export function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Local `yyyy-MM-dd` for N days before today. */
export function localIsoDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toLocalIsoDate(date);
}

/** Whole days spanned by an inclusive `yyyy-MM-dd` range; at least 1. */
export function windowDays(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00`);
  const to = new Date(`${toIso}T00:00:00`);
  const diff = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  return Number.isFinite(diff) && diff > 0 ? diff : 1;
}

/** Duration as `1d 2h 5m`, dropping empty leading units. */
export function formatTimeSpent(minutes: number): string {
  if (!minutes || minutes <= 0) return '0m';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = Math.round(minutes % 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);
  return parts.join(' ');
}

/** Session length as `1h 5m` or `12m`. */
export function formatSessionDuration(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(minutes)}m`;
}

/** Relative day label — `Today`, `Yesterday`, `3 days ago`, then an absolute date. */
export function formatLastActive(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(withUtcSuffix(dateStr));
  const now = new Date();
  // Compare calendar days, not elapsed hours, so "yesterday evening" isn't reported as today.
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateLocal = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((todayLocal.getTime() - dateLocal.getTime()) / 86_400_000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Date + time in the viewer's local zone. */
export function formatUsageTimestamp(dateStr: string): string {
  return new Date(withUtcSuffix(dateStr))
    .toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * The API serializes UTC timestamps without an offset, which JS parses as *local* time — showing
 * every event shifted by the viewer's offset. Adding the `Z` restores the intended instant.
 */
function withUtcSuffix(dateStr: string): string {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(dateStr);
  return hasZone ? dateStr : `${dateStr}Z`;
}

/** Axis label for a `yyyy-MM-dd` day or week-start, e.g. `Jul 15`. */
export function formatDayLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Tailwind classes for a user-status pill. */
export function getStatusClasses(status: string): string {
  switch (status) {
    case 'Active': return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
    case 'At-risk': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
    case 'Dormant': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
    case 'Never': return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300';
  }
}

/** Avatar initials — first + last name, or the first two characters. */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

/**
 * Feature-code → display label. Mirrors the backend's own map; a code missing here falls back to a
 * title-cased version of the code so a newly tracked feature is still readable before this is updated.
 */
export const FEATURE_LABELS: Readonly<Record<string, string>> = {
  'customers': 'Producer Page',
  'dashboard': 'Planting Intention Dashboard',
  'build-a-list': 'Build a List',
  'insights': 'Actionable Insights',
  'unshipped-bushels': 'Unshipped Bushels',
  'bidsheet': 'Bid Sheet',
  'daily-recap': 'Daily Recap',
  'usage-dashboard': 'Usage Dashboard',
  'system': 'System',
  'other': 'Other',
};

export function formatFeatureLabel(code: string): string {
  return FEATURE_LABELS[code] ?? titleCaseCode(code);
}

/** `notes-edit` → `Notes Edit`. */
export function titleCaseCode(code: string): string {
  return code
    .split('-')
    .filter(part => part.length > 0)
    .map(part => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}
