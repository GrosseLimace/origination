import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import type { Customer, PlantingIntention, ProducerDetails } from '@models';
import { ProducerProfilesFake, producerProfile, producerProfilesFake, provideProducerProfiles } from '@testing/producer-profiles.fake';
import { HomeBackgroundFailures } from './home-background-failures';
import { HomePageState } from './home-page.state';
import { HomePlantingStore } from './home-planting.store';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';

const pi = (id: number, customerId = 1, over: Partial<PlantingIntention> = {}) =>
  ({ id, customerId, customerName: 'P', tradeUnit: 'TU1', plantingYear: 2027, crop: 'CORN', acres: 10, ...over }) as PlantingIntention;
const P1 = { id: 1, scoularId: 'S-1', name: 'P1' } as Customer;

describe('HomePlantingStore', () => {
  let store: HomePlantingStore;
  let page: HomePageState;
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let appState: { setPlantingIntentions: ReturnType<typeof vi.fn> };
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let failures: { report: ReturnType<typeof vi.fn> };
  let profiles: ProducerProfilesFake;

  beforeEach(() => {
    api = {
      getPlantingIntentionsByCustomer: vi.fn((): Observable<PlantingIntention[]> => of([pi(30)])),
      createPlantingIntention: vi.fn((d: { crop: string }) => of(pi(700, 1, { crop: d.crop }))),
      updatePlantingIntention: vi.fn((id: number, d: { crop: string }) => of(pi(id, 1, { crop: d.crop }))),
      deletePlantingIntention: vi.fn(() => of(undefined)),
      retagPlantingIntentions: vi.fn(() => of({ moved: 1 })),
      // Answers with what was saved, as the server does.
      saveProducerDetails: vi.fn((id: number, body: { commodities?: string | null }) =>
        of({ id, customerId: id, customerName: 'P1', commodities: body.commodities ?? undefined } as ProducerDetails)),
    };
    appState = { setPlantingIntentions: vi.fn() };
    toast = { success: vi.fn(), error: vi.fn() };
    failures = { report: vi.fn() };
    // P1's saved details: they grow corn.
    profiles = producerProfilesFake([producerProfile(1, { commodities: 'Corn' })]);
    TestBed.configureTestingModule({
      providers: [
        HomePageState, HomePlantingStore,
        { provide: ApiService, useValue: api },
        { provide: AppStateService, useValue: appState },
        { provide: TradeUnitContext, useValue: appState },
        { provide: ToastService, useValue: toast },
        { provide: HomeBackgroundFailures, useValue: failures },
        provideProducerProfiles(profiles),
      ],
    });
    store = TestBed.inject(HomePlantingStore);
    page = TestBed.inject(HomePageState);
    page.selectedCustomer.set(P1);
    page.customers.set([P1]);
  });

  const shown = () => store.customerPlantingIntentions().map(p => p.id);

  describe('reading', () => {
    it('loadForSelection reads once, then serves the cache until forgetAll', () => {
      store.loadForSelection(1);
      store.loadForSelection(1);
      expect(api['getPlantingIntentionsByCustomer']).toHaveBeenCalledTimes(1);
      expect(shown()).toEqual([30]);
      expect(store.allCustomerPlantingIntentions().map(p => p.id)).toEqual([30]);

      store.forgetAll();
      store.loadForSelection(1);
      expect(api['getPlantingIntentionsByCustomer']).toHaveBeenCalledTimes(2);
    });

    it('loadForSelection empties the views while reading, and is cancelled by a new selection', () => {
      const answer = new Subject<PlantingIntention[]>();
      api['getPlantingIntentionsByCustomer'].mockReturnValue(answer);
      store.customerPlantingIntentions.set([pi(1)]);
      store.loadForSelection(1);
      expect(shown()).toEqual([]);

      page.cancelSelection$.next();
      answer.next([pi(30)]);
      expect(shown()).toEqual([]);
    });

    it('loadWithoutCache neither reads nor fills the cache', () => {
      store.loadWithoutCache(1);
      store.loadWithoutCache(1);
      expect(api['getPlantingIntentionsByCustomer']).toHaveBeenCalledTimes(2);
      store.loadForSelection(1);
      expect(api['getPlantingIntentionsByCustomer']).toHaveBeenCalledTimes(3);
    });

    it('drops an older read that lands after a newer one, including a cache restore', () => {
      store.loadForSelection(1); // cache producer 1
      const late = new Subject<PlantingIntention[]>();
      api['getPlantingIntentionsByCustomer'].mockReturnValue(late);
      store.loadWithoutCache(2);
      store.loadForSelection(1); // from cache
      late.next([pi(200, 2)]);
      expect(shown()).toEqual([30]);
    });

    it('reports a failed read', () => {
      const err = new Error('500');
      api['getPlantingIntentionsByCustomer'].mockReturnValue(throwError(() => err));
      store.loadWithoutCache(1);
      expect(failures.report).toHaveBeenCalledWith('load planting intentions', err);
    });
  });

  describe('writing', () => {
    it('add records a new crop on the producer, case-insensitively skipping one it already has', () => {
      store.addPlantingIntention({ crop: 'corn', acres: 1, plantingYear: 2027, tradeUnit: 'TU1' });
      expect(api['saveProducerDetails']).not.toHaveBeenCalled();

      store.addPlantingIntention({ crop: ' SOYBEANS ', acres: 1, plantingYear: 2027, tradeUnit: 'TU1' });
      expect(api['saveProducerDetails']).toHaveBeenCalledWith(1, expect.objectContaining({ commodities: 'Corn,SOYBEANS' }));
      // The new crop shows wherever the producer's details are read.
      expect(profiles.profileOf(1)?.commodities).toBe('Corn,SOYBEANS');
    });

    it('add, edit and delete keep the trade unit\'s list and the shared copy in step', () => {
      page.plantingIntentions.set([pi(30), pi(31)]);
      store.addPlantingIntention({ crop: 'CORN', acres: 1, plantingYear: 2027, tradeUnit: 'TU1' });
      store.editPlantingIntention({ intentionId: 30, crop: 'WHEAT', acres: 5, plantingYear: 2027 });
      store.deletePlantingIntention(31);
      expect(page.plantingIntentions().map(p => [p.id, p.crop])).toEqual([[30, 'WHEAT'], [700, 'CORN']]);
      expect(appState.setPlantingIntentions).toHaveBeenLastCalledWith(page.plantingIntentions());
    });

    it('reports failed writes with the server\'s reason where there is one', () => {
      api['createPlantingIntention'].mockReturnValue(throwError(() => new Error('Duplicate crop.')));
      api['updatePlantingIntention'].mockReturnValue(throwError(() => ({})));
      api['deletePlantingIntention'].mockReturnValue(throwError(() => new Error('x')));
      store.addPlantingIntention({ crop: 'CORN', acres: 1, plantingYear: 2027, tradeUnit: 'TU1' });
      store.editPlantingIntention({ intentionId: 30, crop: 'CORN', acres: 1, plantingYear: 2027 });
      store.deletePlantingIntention(30);
      expect(toast.error.mock.calls.map(c => c[0]))
        .toEqual(['Duplicate crop.', 'Failed to update planting intention', 'Failed to delete planting intention']);
    });
  });

  describe('moving intentions off a trade unit', () => {
    it('does nothing with no moves', () => {
      store.movePlantingIntentions(1, []);
      expect(api['retagPlantingIntentions']).not.toHaveBeenCalled();
    });

    it('reloads into the cache even for a producer that is no longer selected, and says when the reload fails', () => {
      page.selectedCustomer.set(null);
      store.movePlantingIntentions(1, [{ from: 'TU1', to: 'TU2' }]);
      expect(toast.success).toHaveBeenCalledWith('Moved 1 planting intention to TU2.');
      expect(shown()).toEqual([]);
      store.loadForSelection(1);
      expect(api['getPlantingIntentionsByCustomer']).toHaveBeenCalledTimes(1); // served from the reload

      api['getPlantingIntentionsByCustomer'].mockReturnValue(throwError(() => new Error('500')));
      store.movePlantingIntentions(1, [{ from: 'TU1', to: 'TU2' }]);
      expect(toast.error).toHaveBeenCalledWith('Planting intentions moved, but the list couldn\'t be refreshed — reload the page to see them.');
    });
  });
});
