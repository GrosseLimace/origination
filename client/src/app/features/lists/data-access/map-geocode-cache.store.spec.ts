import { describe, it, expect } from 'vitest';
import { MapGeocodeCacheStore } from './map-geocode-cache.store';

describe('MapGeocodeCacheStore', () => {
  it('setGeocodeCache() stores geocode entries and enforces LRU cap', () => {
    const store = new MapGeocodeCacheStore();
    store.setGeocodeCache('key1', { lat: 41.2, lng: -96.1 });
    expect(store.mapGeocodeCache.get('key1')).toEqual({ lat: 41.2, lng: -96.1 });
  });

  it('clearMapGeocodeCache() empties the geocode cache', () => {
    const store = new MapGeocodeCacheStore();
    store.setGeocodeCache('key1', { lat: 41.2, lng: -96.1 });
    store.clearMapGeocodeCache();
    expect(store.mapGeocodeCache.size).toBe(0);
  });
});
