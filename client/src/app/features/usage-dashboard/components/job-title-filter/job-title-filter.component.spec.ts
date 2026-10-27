import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NO_JOB_TITLE_KEY, UsageJobTitle } from '@models';

import { JobTitleFilterComponent } from './job-title-filter.component';

function title(over: Partial<UsageJobTitle> = {}): UsageJobTitle {
  return { key: 'Senior Merchant', label: 'Senior Merchant', userCount: 4, ...over };
}

/**
 * The filter is presentational: the roster arrives as an input (the dashboard page loads it, scoped
 * to the selected manager). These cover what the component itself decides — multi-select toggling,
 * search, the button label, and the retry hand-off.
 */
describe('JobTitleFilterComponent', () => {
  let fixture: ComponentFixture<JobTitleFilterComponent>;
  let component: JobTitleFilterComponent;
  const roster: UsageJobTitle[] = [
    title(),
    title({ key: 'Merchant', label: 'Merchant', userCount: 12 }),
    title({ key: 'Trader', label: 'Trader', userCount: 3 }),
    title({ key: NO_JOB_TITLE_KEY, label: 'No title', userCount: 7 }),
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    TestBed.overrideComponent(JobTitleFilterComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    fixture = TestBed.createComponent(JobTitleFilterComponent);
    fixture.componentRef.setInput('titles', roster);
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  it('toggles titles in and out of the selection, keeping the others', () => {
    component.toggleTitle('Merchant');
    component.toggleTitle('Trader');
    expect(component.selected()).toEqual(['Merchant', 'Trader']);

    component.toggleTitle('Merchant');
    expect(component.selected()).toEqual(['Trader']);
  });

  it('treats a key as selected case-insensitively', () => {
    // The API compares titles case-insensitively, so the picker must not show a title as unticked
    // just because a bookmark or the roster cased it differently.
    component.selected.set(['merchant']);

    expect(component.isSelected('Merchant')).toBe(true);
    component.toggleTitle('MERCHANT');
    expect(component.selected()).toEqual([]);
  });

  it('labels the button with the one chosen title, then with a count', () => {
    expect(component.buttonLabel()).toBe('All Job Titles');

    component.toggleTitle('Trader');
    expect(component.buttonLabel()).toBe('Trader');

    component.toggleTitle(NO_JOB_TITLE_KEY);
    expect(component.buttonLabel()).toBe('2 job titles');
  });

  it('labels the synthetic "No title" key readably even before the roster has loaded', () => {
    fixture.componentRef.setInput('titles', []);
    component.selected.set([NO_JOB_TITLE_KEY]);

    expect(component.buttonLabel()).toBe('No title');
  });

  it('narrows candidates by label, but never hides a selected title', () => {
    component.toggleTitle('Trader');
    component.search.set('merch');

    expect(component.candidates().map(t => t.key)).toEqual(['Senior Merchant', 'Merchant', 'Trader']);
  });

  it('clear() empties the selection and closes', () => {
    component.toggle();
    component.toggleTitle('Trader');
    component.search.set('tr');

    component.clear();

    expect(component.selected()).toEqual([]);
    expect(component.open()).toBe(false);
    expect(component.search()).toBe('');
  });

  it('retry is handed to the parent, which owns the load', () => {
    let retries = 0;
    component.retry.subscribe(() => retries++);
    fixture.componentRef.setInput('loadFailed', true);

    component.retry.emit();

    expect(retries).toBe(1);
  });
});
