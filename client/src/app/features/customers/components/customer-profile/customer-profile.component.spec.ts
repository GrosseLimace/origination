import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { CustomerProfileComponent } from './customer-profile.component';
import { ApiService } from '@core/services/api.service';
import { ThemeService } from '@core/services/theme.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer, SavedList } from '@models';

// Covers the Add-to-List "Team Lists" manager extension: the dropdown stages membership across
// BOTH the user's own saved lists and (for managers) team lists, and the toggle is manager-gated.

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 1, scoularId: 'CUST1', name: 'Test Farm', farm: 'Test Farm LLC', location: 'Omaha, NE',
    phone: '', email: '', totalAcres: 0, linkedProducerIds: [], eSignEnabled: false, ...over,
  };
}

function makeList(over: Partial<SavedList> = {}): SavedList {
  return { id: 1, name: 'List', query: 'corn', createdAt: '2026-01-01', ...over };
}

describe('CustomerProfileComponent — Add to List (Team Lists)', () => {
  let component: CustomerProfileComponent;
  let ref: ComponentRef<CustomerProfileComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: {} },
        { provide: ThemeService, useValue: {} },
        { provide: UsageTrackingService, useValue: { trackCallClick: () => {}, trackEmailClick: () => {}, postClickEvent: () => {} } },
      ],
    });
    // happy-dom + JIT can't fetch templateUrl, and the child imports carry their own templates.
    // Blank template + imports so JIT compiles a bare shell; the staging logic is class-level.
    TestBed.overrideComponent(CustomerProfileComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    const fixture = TestBed.createComponent(CustomerProfileComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    ref.setInput('customer', makeCustomer({ id: 42 }));
  });

  it('stages changes across both own and team lists into one diff (manager)', () => {
    ref.setInput('isManager', true);
    ref.setInput('savedListsForCustomer', [makeList({ id: 1, name: 'My List' })]);
    ref.setInput('teamListsForCustomer', [makeList({ id: 2, name: "Joe's List", createdBy: 'Joe' })]);

    const emitted: { listId: number; add: boolean }[][] = [];
    component.onSaveSavedListMembership.subscribe(c => emitted.push(c));

    component.toggleAddToListMenu();           // seed staged from both sets (both currently out)
    component.toggleStaged(makeList({ id: 1 })); // add producer to own list
    component.toggleStaged(makeList({ id: 2 })); // add producer to team list
    expect(component.hasStagedChanges()).toBe(true);
    component.saveAddToList();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(
      expect.arrayContaining([
        { listId: 1, add: true },
        { listId: 2, add: true },
      ]),
    );
    expect(emitted[0]).toHaveLength(2);
    expect(component.showAddToListMenu()).toBe(false); // menu closed after save
  });

  it('ignores team lists in the staging diff when the user is not a manager', () => {
    ref.setInput('isManager', false);
    ref.setInput('savedListsForCustomer', [makeList({ id: 1, name: 'My List' })]);
    ref.setInput('teamListsForCustomer', [makeList({ id: 2, name: "Joe's List", createdBy: 'Joe' })]);

    const emitted: { listId: number; add: boolean }[][] = [];
    component.onSaveSavedListMembership.subscribe(c => emitted.push(c));

    component.toggleAddToListMenu();
    component.toggleStaged(makeList({ id: 1 }));
    component.toggleStaged(makeList({ id: 2 })); // staged, but not a known non-manager list
    component.saveAddToList();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual([{ listId: 1, add: true }]); // team list 2 excluded
  });

  it('activeAddToLists follows the selected tab', () => {
    ref.setInput('isManager', true);
    ref.setInput('savedListsForCustomer', [makeList({ id: 1, name: 'My List' })]);
    ref.setInput('teamListsForCustomer', [makeList({ id: 2, name: "Joe's List" })]);

    component.addToListTab.set('saved');
    expect(component.activeAddToLists().map(l => l.id)).toEqual([1]);
    component.addToListTab.set('team');
    expect(component.activeAddToLists().map(l => l.id)).toEqual([2]);
  });
});
