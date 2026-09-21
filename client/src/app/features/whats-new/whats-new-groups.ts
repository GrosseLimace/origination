import type { WhatsNewItem, WhatsNewRelease } from '@models';

/** A run of a release's items sharing one heading. */
export interface WhatsNewItemGroup {
  /** Null when the items carry no group, so the list renders with no heading. */
  heading: string | null;
  items: WhatsNewItem[];
}

/** A release with its items pre-grouped and its date made readable, so templates do neither. */
export interface GroupedRelease {
  release: WhatsNewRelease;
  groups: WhatsNewItemGroup[];
  /** releasedOn written out, e.g. "September 15, 2026". */
  displayDate: string;
}

/**
 * Splits each release's items into headed groups.
 *
 * Grouping is by CONSECUTIVE RUNS, not by collecting every item with the same key: the file's
 * order is the display order, so an author moving an item moves it on screen, and a group name
 * reused further down honestly produces a second block rather than teleporting items upwards.
 *
 * A release whose items have no group at all comes back as a single heading-less group.
 */
export function groupReleases(releases: readonly WhatsNewRelease[]): GroupedRelease[] {
  return releases.map(release => ({
    release,
    groups: groupItems(release.items),
    displayDate: formatReleaseDate(release.releasedOn)
  }));
}

function groupItems(items: readonly WhatsNewItem[]): WhatsNewItemGroup[] {
  const groups: WhatsNewItemGroup[] = [];

  for (const item of items) {
    // Treat an empty or whitespace-only group as absent rather than rendering a blank heading,
    // so a typo in the notes file degrades to the old flat list.
    const heading = item.group?.trim() ? item.group.trim() : null;
    const current = groups.at(-1);

    if (current !== undefined && current.heading === heading) {
      current.items.push(item);
    } else {
      groups.push({ heading, items: [item] });
    }
  }

  return groups;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Writes a YYYY-MM-DD release date out in full.
 *
 * Parsed straight from the string rather than through Date or DatePipe on purpose. A bare
 * "2026-09-15" is read as UTC midnight, which renders as the 14th anywhere west of Greenwich —
 * so every release would appear to have shipped a day early for users in the US.
 */
export function formatReleaseDate(releasedOn: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(releasedOn);
  if (match === null) return releasedOn;

  const [, year, month, day] = match;
  const name = MONTHS[Number(month) - 1];
  return name === undefined ? releasedOn : name + ' ' + Number(day) + ', ' + year;
}
