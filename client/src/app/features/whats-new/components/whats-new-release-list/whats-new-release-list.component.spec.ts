import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WhatsNewItem, WhatsNewRelease } from '@models';
import { WhatsNewReleaseListComponent } from './whats-new-release-list.component';

/**
 * The release list is shared by the What's New dialog ('compact') and the history page ('timeline').
 * Grouping/date rules are pinned in whats-new-groups.spec.ts; this pins what each variant RENDERS
 * from them (real template):
 *  - items render under their group headings, with the user-facing kind label (New / Improved / Fixed),
 *  - compact: no release title/summary, and dates only when more than one release is stacked,
 *  - timeline: title, version, optional summary, readable date, and "Current" on the first release only.
 */

function item(over: Partial<WhatsNewItem> = {}): WhatsNewItem {
  return { kind: 'added', text: 'Something new', ...over };
}

function release(over: Partial<WhatsNewRelease> = {}): WhatsNewRelease {
  return {
    version: '2026.10.13',
    releasedOn: '2026-10-13',
    title: 'October release',
    summary: 'Bin sites and more.',
    items: [item()],
    ...over,
  };
}

describe('WhatsNewReleaseListComponent', () => {
  let fixture: ComponentFixture<WhatsNewReleaseListComponent>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => host().textContent ?? '';
  const headings = (): string[] => Array.from(host().querySelectorAll('h5')).map(h => h.textContent?.trim() ?? '');
  const itemRows = (): string[] =>
    Array.from(host().querySelectorAll('li.items-start')).map(li =>
      Array.from(li.querySelectorAll('span')).map(s => (s.textContent ?? '').trim()).join(' '));

  function render(releases: WhatsNewRelease[], variant: 'timeline' | 'compact' = 'timeline'): void {
    fixture.componentRef.setInput('releases', releases);
    fixture.componentRef.setInput('variant', variant);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [WhatsNewReleaseListComponent] }).compileComponents();
    fixture = TestBed.createComponent(WhatsNewReleaseListComponent);
  });

  it('labels each item with its user-facing kind, not the JSON value', () => {
    render([release({ items: [
      item({ kind: 'added', text: 'Bin sites' }),
      item({ kind: 'changed', text: 'Faster search' }),
      item({ kind: 'fixed', text: 'Print layout' }),
    ] })]);

    expect(itemRows()).toEqual(['New Bin sites', 'Improved Faster search', 'Fixed Print layout']);
  });

  it('renders items under their group headings in file order, with no heading for ungrouped items', () => {
    render([release({ items: [
      item({ text: 'Loose item' }),
      item({ text: 'Site list', group: 'Bin sites' }),
      item({ text: 'Site map', group: 'Bin sites' }),
      item({ text: 'Sold bushels', group: 'Grain on Farm' }),
    ] })]);

    expect(headings()).toEqual(['Bin sites', 'Grain on Farm']);
    expect(itemRows().map(r => r.replace(/^New /, ''))).toEqual(['Loose item', 'Site list', 'Site map', 'Sold bushels']);
  });

  describe('timeline variant (history page)', () => {
    it('shows the title, summary, version and a readable local date for each release', () => {
      render([release()]);

      expect(host().querySelector('h3')?.textContent?.trim()).toBe('October release');
      expect(text()).toContain('Bin sites and more.');
      expect(text()).toContain('Version 2026.10.13');
      expect(text()).toContain('October 13, 2026');
    });

    it('omits the summary paragraph when a release has none', () => {
      render([release({ summary: undefined })]);
      expect(text()).not.toContain('Bin sites and more.');
      expect(host().querySelector('h3')).not.toBeNull();
    });

    it('marks only the first (newest) release as Current', () => {
      render([
        release({ version: '3', title: 'Newest' }),
        release({ version: '2', title: 'Older' }),
        release({ version: '1', title: 'Oldest' }),
      ]);

      const releases = Array.from(host().querySelectorAll('ol > li'));
      expect(releases.length).toBe(3);
      expect(releases.map(li => (li.textContent ?? '').includes('Current'))).toEqual([true, false, false]);
    });

    it('draws the connecting rail between releases but not after the last one', () => {
      render([release({ version: '2' }), release({ version: '1' })]);

      const releases = Array.from(host().querySelectorAll('ol > li'));
      const railLines = releases.map(li => li.querySelectorAll('[aria-hidden="true"] > span').length);
      expect(railLines).toEqual([2, 1]); // marker + line, then marker only
    });
  });

  describe('compact variant (dialog)', () => {
    it('does not repeat the release title or summary', () => {
      render([release()], 'compact');

      expect(host().querySelector('h3')).toBeNull();
      expect(text()).not.toContain('October release');
      expect(text()).not.toContain('Bin sites and more.');
      expect(itemRows()).toEqual(['New Something new']);
    });

    it('omits the date for a single release', () => {
      render([release()], 'compact');
      expect(text()).not.toContain('October 13, 2026');
    });

    it('dates each release when several unseen releases are stacked', () => {
      render([release({ version: '2', releasedOn: '2026-10-13' }), release({ version: '1', releasedOn: '2026-09-29' })], 'compact');

      expect(text()).toContain('October 13, 2026');
      expect(text()).toContain('September 29, 2026');
    });
  });
});
