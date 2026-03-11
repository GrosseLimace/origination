import { describe, it, expect, beforeEach } from 'vitest';
import { AppStateService } from './app-state.service';
import { Customer } from '@models';

const mockCustomer: Customer = {
  id: 1,
  name: 'Test Farm',
  farm: 'Test Farm LLC',
  location: 'Omaha, NE',
  phone: '402-555-0100',
  email: 'test@farm.com',
  totalAcres: 500,
  linkedProducerIds: [],
  eSignEnabled: false,
};

describe('AppStateService', () => {
  let service: AppStateService;

  beforeEach(() => {
    service = new AppStateService();
  });

  it('initialises with default signal values', () => {
    expect(service.currentView()).toBe('customers');
    expect(service.selectedCustomer()).toBeNull();
    expect(service.selectedTradeUnits()).toEqual([]);
    expect(service.searchQuery()).toBe('');
    expect(service.customers()).toEqual([]);
  });

  it('setView() updates currentView signal', () => {
    service.setView('dashboard');
    expect(service.currentView()).toBe('dashboard');
  });

  it('selectCustomer() stores the selected customer', () => {
    service.selectCustomer(mockCustomer);
    expect(service.selectedCustomer()).toEqual(mockCustomer);
  });

  it('selectCustomer(null) clears the selection', () => {
    service.selectCustomer(mockCustomer);
    service.selectCustomer(null);
    expect(service.selectedCustomer()).toBeNull();
  });

  it('setTradeUnits() updates the selectedTradeUnits signal', () => {
    service.setTradeUnits(['TU1', 'TU2']);
    expect(service.selectedTradeUnits()).toEqual(['TU1', 'TU2']);
  });

  it('setSearchQuery() updates the searchQuery signal', () => {
    service.setSearchQuery('grain');
    expect(service.searchQuery()).toBe('grain');
  });

  it('setCustomers() / contracts / tickets update data cache signals', () => {
    service.setCustomers([mockCustomer]);
    expect(service.customers()).toHaveLength(1);
    expect(service.customers()[0].id).toBe(1);
  });

  it('clearAll() resets all state to defaults', () => {
    service.selectCustomer(mockCustomer);
    service.setTradeUnits(['TU1']);
    service.setSearchQuery('test');
    service.setCustomers([mockCustomer]);
    service.clearAll();
    expect(service.selectedCustomer()).toBeNull();
    expect(service.selectedTradeUnits()).toEqual([]);
    expect(service.searchQuery()).toBe('');
    expect(service.customers()).toEqual([]);
  });

  it('setGeocodeCache() stores geocode entries and enforces LRU cap', () => {
    service.setGeocodeCache('key1', { lat: 41.2, lng: -96.1 });
    expect(service.mapGeocodeCache.get('key1')).toEqual({ lat: 41.2, lng: -96.1 });
  });

  it('clearMapGeocodeCache() empties the geocode cache', () => {
    service.setGeocodeCache('key1', { lat: 41.2, lng: -96.1 });
    service.clearMapGeocodeCache();
    expect(service.mapGeocodeCache.size).toBe(0);
  });

  it('setInsightsCache() and clearInsightsCache() manage insights cache', () => {
    const entry = {
      tradeUnitsKey: 'TU1',
      customers: [],
      contracts: [],
      tickets: [],
      notes: [],
      loadedAt: new Date(),
    };
    service.setInsightsCache(entry);
    expect(service.insightsCache()).toEqual(entry);
    service.clearInsightsCache();
    expect(service.insightsCache()).toBeNull();
  });
});
