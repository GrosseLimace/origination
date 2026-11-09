import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AppStateService } from '@core/services/app-state.service';
import { CustomerListScrollStore } from './customer-list-scroll.store';

describe('CustomerListScrollStore', () => {
  it('is cleared when the session ends', () => {
    const store = TestBed.inject(CustomerListScrollStore);
    store.setLastScrolledCustomerId(42);

    TestBed.inject(AppStateService).clearAll();

    expect(store.lastScrolledCustomerId()).toBeNull();
  });
});
