import { describe, it, expect } from 'vitest';
import { formatReleaseDate, groupReleases } from './whats-new-groups';
import type { WhatsNewItem, WhatsNewRelease } from '@models';

function makeRelease(items: WhatsNewItem[]): WhatsNewRelease {
  return { version: '2026.09.1', releasedOn: '2026-09-15', title: 'A release', items };
}

describe('groupReleases', () => {
  it('returns a single heading-less group when no item carries one', () => {
    const [grouped] = groupReleases([
      makeRelease([
        { kind: 'added', text: 'One' },
        { kind: 'fixed', text: 'Two' }
      ])
    ]);

    expect(grouped.groups).toHaveLength(1);
    expect(grouped.groups[0].heading).toBeNull();
    expect(grouped.groups[0].items).toHaveLength(2);
  });

  it('splits consecutive runs into separate headed groups', () => {
    const [grouped] = groupReleases([
      makeRelease([
        { kind: 'added', text: 'One', group: 'Bid Sheet' },
        { kind: 'changed', text: 'Two', group: 'Bid Sheet' },
        { kind: 'fixed', text: 'Three', group: 'Notes' }
      ])
    ]);

    expect(grouped.groups.map(g => g.heading)).toEqual(['Bid Sheet', 'Notes']);
    expect(grouped.groups[0].items).toHaveLength(2);
    expect(grouped.groups[1].items).toHaveLength(1);
  });

  it('honours file order rather than collecting by name', () => {
    // A name that stops and restarts renders as two blocks — the author controls the order, and
    // nothing is silently rearranged. The backend content test flags this as a mis-ordered file.
    const [grouped] = groupReleases([
      makeRelease([
        { kind: 'added', text: 'One', group: 'Bid Sheet' },
        { kind: 'added', text: 'Two', group: 'Notes' },
        { kind: 'added', text: 'Three', group: 'Bid Sheet' }
      ])
    ]);

    expect(grouped.groups.map(g => g.heading)).toEqual(['Bid Sheet', 'Notes', 'Bid Sheet']);
  });

  it('treats a blank or whitespace-only group as absent', () => {
    const [grouped] = groupReleases([
      makeRelease([
        { kind: 'added', text: 'One', group: '   ' },
        { kind: 'added', text: 'Two', group: '' }
      ])
    ]);

    expect(grouped.groups).toHaveLength(1);
    expect(grouped.groups[0].heading).toBeNull();
  });

  it('trims surrounding whitespace from a heading', () => {
    const [grouped] = groupReleases([
      makeRelease([{ kind: 'added', text: 'One', group: '  Bid Sheet  ' }])
    ]);

    expect(grouped.groups[0].heading).toBe('Bid Sheet');
  });

  it('groups each release independently and preserves release order', () => {
    const grouped = groupReleases([
      makeRelease([{ kind: 'added', text: 'Newer', group: 'A' }]),
      { ...makeRelease([{ kind: 'fixed', text: 'Older' }]), version: '2026.08.1' }
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0].release.version).toBe('2026.09.1');
    expect(grouped[1].groups[0].heading).toBeNull();
  });

  it('returns an empty list for no releases', () => {
    expect(groupReleases([])).toEqual([]);
  });
});

describe('formatReleaseDate', () => {
  it('writes the date out in full', () => {
    expect(formatReleaseDate('2026-09-15')).toBe('September 15, 2026');
  });

  it('drops the leading zero from the day', () => {
    expect(formatReleaseDate('2026-08-04')).toBe('August 4, 2026');
  });

  it('reports the date as written, never shifted by the reader timezone', () => {
    // Parsing "2026-01-01" through Date reads it as UTC midnight, which is 31 December anywhere
    // west of Greenwich — so every release would look a day early across the US.
    expect(formatReleaseDate('2026-01-01')).toBe('January 1, 2026');
    expect(formatReleaseDate('2026-12-31')).toBe('December 31, 2026');
  });

  it('hands back anything it does not recognise untouched', () => {
    expect(formatReleaseDate('not a date')).toBe('not a date');
    expect(formatReleaseDate('2026-13-01')).toBe('2026-13-01');
  });

  it('exposes the formatted date on each grouped release', () => {
    const [grouped] = groupReleases([makeRelease([{ kind: 'added', text: 'One' }])]);

    expect(grouped.displayDate).toBe('September 15, 2026');
  });
});
