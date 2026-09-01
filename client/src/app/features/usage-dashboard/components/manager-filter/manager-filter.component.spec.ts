import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import { ApiService } from '@core/services/api.service';
import { UsageManager } from '@models';

import { ManagerFilterComponent } from './manager-filter.component';

function manager(over: Partial<UsageManager> = {}): UsageManager {
  return { userId: 'KCanning', displayName: 'Kyle Canning', directReports: 13, totalReports: 45, ...over };
}

describe('ManagerFilterComponent', () => {
  let api: {
    getUsageManagers: () => Observable<UsageManager[]>;
    listCalls: number;
    roster: UsageManager[];
  };
  let component: ManagerFilterComponent;

  function build(): ManagerFilterComponent {
    const fixture = TestBed.createComponent(ManagerFilterComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    api = {
      listCalls: 0,
      roster: [
        manager(),
        manager({ userId: 'QMaass', displayName: 'Quinn Maass', directReports: 5, totalReports: 67 }),
        manager({ userId: 'APatterson', displayName: 'Amy Patterson', directReports: 1, totalReports: 1 }),
      ],
      getUsageManagers() { this.listCalls++; return of(this.roster); },
    };

    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }],
    });
    TestBed.overrideComponent(ManagerFilterComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    component = build();
  });

  it('does not load the roster until the dropdown is opened', () => {
    expect(api.listCalls).toBe(0);

    component.toggle();
    expect(api.listCalls).toBe(1);
    expect(component.managers().length).toBe(3);
  });

  it('does not reload an already-loaded roster when reopened', () => {
    component.toggle();
    component.toggle();
    component.toggle();

    expect(api.listCalls).toBe(1);
  });

  it('narrows candidates by name or id, case-insensitively', () => {
    component.toggle();

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
    component.toggle();
    component.managerId.set('kcanning');

    expect(component.selected()?.displayName).toBe('Kyle Canning');
  });

  it('clear() nulls the model', () => {
    component.toggle();
    component.select(manager());

    component.clear();

    expect(component.managerId()).toBeNull();
  });

  it('a failed load shows the retry state instead of an empty roster', () => {
    api.getUsageManagers = () => throwError(() => ({ status: 503 }));
    component.toggle();

    expect(component.loadFailed()).toBe(true);
    expect(component.loading()).toBe(false);

    // Retry succeeds once the directory is back.
    api.getUsageManagers = () => of([manager()]);
    component.load();

    expect(component.loadFailed()).toBe(false);
    expect(component.managers().length).toBe(1);
  });
});
