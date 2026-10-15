/**
 * Note display rules, the same as the desktop's customer-notes component (formatTimestamp, getInitials),
 * so a note reads identically on both.
 */

/** "Today at 3:15 PM", "Yesterday at …", "3 days ago", else "Oct 7, 2026". Bare ISO strings are UTC. */
export function formatNoteTimestamp(timestamp: string | Date, now: Date = new Date()): string {
  const raw = typeof timestamp === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(timestamp) ? timestamp + 'Z' : timestamp;
  const date = new Date(raw);
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  // Calendar days in local time, not raw milliseconds (7:57 PM yesterday is "Yesterday", not "Today").
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  const noteMidnight = new Date(date);
  noteMidnight.setHours(0, 0, 0, 0);
  const diffDays = Math.round((todayMidnight.getTime() - noteMidnight.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return `Today at ${timeStr}`;
  if (diffDays === 1) return `Yesterday at ${timeStr}`;
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Caden Egr" → "CE"; one word → its first two letters; nothing usable → "??". */
export function noteInitials(name: string | null | undefined): string {
  const parts = (name ?? '').split(' ').filter((p) => p.length > 0);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1 && parts[0].length >= 2) return parts[0].substring(0, 2).toUpperCase();
  return '??';
}

/**
 * "today", "yesterday", "3 days ago", else "Sep 1, 2026" — for "Updated … by …" lines (card #643:
 * edits are attributed and timestamped). Same calendar-day rule and UTC handling as formatNoteTimestamp.
 */
export function formatUpdatedAgo(timestamp: string | Date, now: Date = new Date()): string {
  const raw = typeof timestamp === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(timestamp) ? timestamp + 'Z' : timestamp;
  const date = new Date(raw);
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  const dayMidnight = new Date(date);
  dayMidnight.setHours(0, 0, 0, 0);
  const diffDays = Math.round((todayMidnight.getTime() - dayMidnight.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
