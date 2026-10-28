import { ChangeDetectionStrategy, Component, computed, input, model, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { NO_JOB_TITLE_KEY, UsageJobTitle } from '@models';

/**
 * Job-title filter for the usage dashboard: a searchable checkbox list over the titles recorded
 * from users' sign-in tokens. Ticking titles narrows every panel to people whose latest recorded
 * title is one of them. "No title" is a real option — it covers people with no directory title and
 * people who have not signed in since titles were first captured. Clearing it shows everyone.
 *
 * Presentational, like the manager filter: the roster arrives as an input because the dashboard
 * page owns the load (the roster is counted within the selected manager's team, so the page reloads
 * it when that changes). Unlike the manager filter, the roster is not needed before the first data
 * fetch — the filter starts empty — so a slow or failed roster never blocks the page.
 */
@Component({
  selector: 'app-job-title-filter',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './job-title-filter.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class JobTitleFilterComponent {
  /** Two-way: the selected title keys, exactly as the API expects them back. Empty = no filter. */
  readonly selected = model<string[]>([]);

  readonly titles = input<UsageJobTitle[]>([]);
  readonly loading = input(false);
  readonly loadFailed = input(false);

  /** The user asked to reload the roster after a failed load. */
  readonly retry = output<void>();

  readonly open = signal(false);
  readonly search = signal('');

  readonly selectedCount = computed(() => this.selected().length);

  /** Button text: the one chosen title, or a count when several are chosen. */
  readonly buttonLabel = computed(() => {
    const keys = this.selected();
    if (keys.length === 0) return 'All Job Titles';
    if (keys.length === 1) return this.labelFor(keys[0]);
    return `${keys.length} job titles`;
  });

  /** Titles matching the search. Selected titles stay visible even when they don't match, so a
   *  search can never hide what is currently filtering the page. */
  readonly candidates = computed<UsageJobTitle[]>(() => {
    const q = this.search().trim().toLowerCase();
    const selected = new Set(this.selected().map(k => k.toLowerCase()));
    return this.titles().filter(t => !q || selected.has(t.key.toLowerCase()) || t.label.toLowerCase().includes(q));
  });

  isSelected(key: string): boolean {
    const k = key.toLowerCase();
    return this.selected().some(s => s.toLowerCase() === k);
  }

  toggle(): void {
    this.open.set(!this.open());
  }

  close(): void {
    this.open.set(false);
    this.search.set('');
  }

  toggleTitle(key: string): void {
    const k = key.toLowerCase();
    const current = this.selected();
    this.selected.set(this.isSelected(key)
      ? current.filter(s => s.toLowerCase() !== k)
      : [...current, key]);
  }

  clear(): void {
    this.selected.set([]);
    this.close();
  }

  private labelFor(key: string): string {
    if (key === NO_JOB_TITLE_KEY) return 'No title';
    const k = key.toLowerCase();
    return this.titles().find(t => t.key.toLowerCase() === k)?.label ?? key;
  }
}
