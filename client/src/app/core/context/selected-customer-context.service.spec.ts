import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Customer } from '@models';
import { AppStateService } from '@core/services/app-state.service';
import { SelectedCustomerContext } from './selected-customer-context.service';

describe('SelectedCustomerContext', () => {
  const selectedCustomer = signal<Customer | null>(null);
  let context: SelectedCustomerContext;

  beforeEach(() => {
    selectedCustomer.set(null);
    TestBed.configureTestingModule({
      providers: [SelectedCustomerContext, { provide: AppStateService, useValue: { selectedCustomer } }],
    });
    context = TestBed.inject(SelectedCustomerContext);
  });

  it('has no customer and no segment before one is picked', () => {
    expect(context.customer()).toBeNull();
    expect(context.segment()).toBeNull();
  });

  it('follows the selected customer, and counts every customer as a producer', () => {
    selectedCustomer.set({ id: 1, name: 'Alpha Acres' } as Customer);

    expect(context.customer()?.name).toBe('Alpha Acres');
    expect(context.segment()).toBe('Producer');
  });

  describe('appliesTo', () => {
    it('applies a contribution that lists no segments to every customer, and with none selected', () => {
      expect(context.appliesTo({})).toBe(true);
      expect(context.appliesTo({ segments: [] })).toBe(true);

      selectedCustomer.set({ id: 1, name: 'Alpha Acres' } as Customer);
      expect(context.appliesTo({})).toBe(true);
    });

    it("applies a segment's contribution only to a customer in that segment", () => {
      selectedCustomer.set({ id: 1, name: 'Alpha Acres' } as Customer);

      expect(context.appliesTo({ segments: ['Producer'] })).toBe(true);
      expect(context.appliesTo({ segments: ['Commercial'] })).toBe(false);
      expect(context.appliesTo({ segments: ['Commercial', 'Producer'] })).toBe(true);
    });

    it("applies no segment's contribution while no customer is selected", () => {
      expect(context.appliesTo({ segments: ['Producer'] })).toBe(false);
    });
  });
});
