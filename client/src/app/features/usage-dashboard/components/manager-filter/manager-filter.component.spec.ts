import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UsageManager } from '@models';

import { ManagerFilterComponent } from './manager-filter.component';

function manager(over: Partial<UsageManager> = {}): UsageManager {
  return { userId: 'KCanning', displayName: 'Kyle Canning', directReports: 13, totalReports: 45, ...over };
}

/**
 * The filter is presentational: the roster arrives as an input (the dashboard page loads it, because
 * it needs the roster before its first fetch to default the selection to the signed-in user). These
 * cover what the component itself decides — search, selection, and the retry hand-off.
 */
describe('ManagerFilterComponent', () => {
  let fixture: ComponentFixture<ManagerFilterComponent>;
  let component: ManagerFilterComponent;
  const roster: UsageManager[] = [
    manager(),
    manager({ userId: 'QMaass', displayName: 'Quinn Maass', directReports: 5, totalReports: 67 }),
    manager({ userId: 'APatterson', displayName: 'Amy Patterson', directReports: 1, totalReports: 1 }),
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    TestBed.overrideComponent(ManagerFilterComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    fixture = TestBed.createComponent(ManagerFilterComponent);
    fixture.componentRef.setInput('managers', roster);
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  it('narrows candidates by name or id, case-insensitively', () => {
    component.search.set('maass');
    expect(component.candidates().map(m => m.userId)).toEqual(['QMaass']);

    component.search.set('kcan');
    expect(component.candidates().map(m => m.userId)).toEqual(['KCanning']);
  });

  it('select() sets the model, closes, and clears the search', () => {
    component.toggle();
    component.search.set('kyle');

    component.select(manager());

    expect(component.managerId()).toBe('KCanning');
    expect(component.open()).toBe(false);
    expect(component.search()).toBe('');
  });

  it('resolves the selected manager case-insensitively against the roster', () => {
    // The default selection is the signed-in user's short name from /api/me, whose casing need not
    // match the directory's.
    component.managerId.set('kcanning');

    expect(component.selected()?.displayName).toBe('Kyle Canning');
  });

  it('shows no selection for a name that is not in the roster', () => {
    component.managerId.set('NotAManager');

    expect(component.selected()).toBeNull();
  });

  it('clear() nulls the model', () => {
    component.select(manager());

    component.clear();

    expect(component.managerId()).toBeNull();
  });

  it('retry is handed to the parent, which owns the load', () => {
    let retries = 0;
    component.retry.subscribe(() => retries++);
    fixture.componentRef.setInput('loadFailed', true);

    component.retry.emit();

    expect(retries).toBe(1);
  });
});
