import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AppStateService } from '@core/services/app-state.service';
import { BuildListStore } from './build-list.store';

describe('BuildListStore', () => {
  it("is cleared when the session ends, so the next user doesn't see this one's list", () => {
    const store = TestBed.inject(BuildListStore);
    store.setBuildListState({
      queryText: 'corn growers', filteredCustomerIds: [1, 2], hasGenerated: true, showMap: false, detectedState: null, tradeUnits: ['1084'],
    });

    TestBed.inject(AppStateService).clearAll();

    expect(store.buildListState()).toBeNull();
  });
});
