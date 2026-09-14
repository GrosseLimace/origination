import type { WhatsNewItem, WhatsNewRelease } from '@models';

/** A run of a release's items sharing one heading. */
export interface WhatsNewItemGroup {
  /** Null when the items carry no group, so the list renders with no heading. */
  heading: string | null;
  items: WhatsNewItem[];
}

/** A release with its items pre-grouped, so templates never do the grouping. */
export interface GroupedRelease {
  release: WhatsNewRelease;
  groups: WhatsNewItemGroup[];
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
    groups: groupItems(release.items)
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
