import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NEVER, Observable, Subject, of, throwError } from 'rxjs';
import type { Contract, Customer, DashboardPlantingEstimate, DpContract, PlantingIntention, ProducerDetails, StoredGrain, Ticket } from '@models';
import { SessionReset } from '@core/auth/session-reset.service';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { markShown } from '@core/http/shown-errors';
import { ApiService } from '@core/services/api.service';
import { HandledErrorReporter } from '@core/services/handled-error-reporter.service';
import { ToastService } from '@core/services/toast.service';
import { permissionStub, providePermissions } from '@testing/permission.stub';
import { ProducerProfilesFake, producerProfile, producerProfilesFake, provideProducerProfiles } from '@testing/producer-profiles.fake';
import { SelectedProducerActivityFake, provideSelectedProducerActivity, selectedProducerActivityFake } from '@testing/selected-producer-activity.fake';
import { ProducerProductionStore } from './producer-production.store';
import { ProducerStore } from './producer.store';
import { ProducersApiService } from './producers-api.service';

const pi = (id: number, customerId = 1, over: Partial<PlantingIntention> = {}) =>
  ({ id, customerId, customerName: 'P', tradeUnit: 'TU1', plantingYear: 2027, crop: 'CORN', acres: 10, ...over }) as PlantingIntention;
const grain = (id: string, customerId = 1) => ({ id, customerId }) as StoredGrain;
const dp = (id: string, customerId = 1) => ({ id, customerId }) as DpContract;
const P1 = { id: 1, scoularId: 'S-1', name: 'P1' } as Customer;
const P2 = { id: 2, scoularId: 'S-2', name: 'P2' } as Customer;

/**
 * The selected producer's production, which the customer screen's Planting, Storage and DP tabs and the producer
 * panels read: the reads per selection and what they keep, the crop year being looked at, the planting writes and
 * moves, and the commodity auto-save into the producer's details.
 */
describe('ProducerProductionStore', () => {
  let store: ProducerProductionStore;
  let producers: ProducerStore;
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let appApi: { saveProducerDetails: ReturnType<typeof vi.fn> };
  let activity: SelectedProducerActivityFake;
  let profiles: ProducerProfilesFake;
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let reporter: { send: ReturnType<typeof vi.fn> };

  const shown = () => store.plantingIntentions().map(p => p.id);
  const callsFor = (fn: ReturnType<typeof vi.fn>, id: number) => fn.mock.calls.filter(args => args[0] === id).length;

  beforeEach(() => {
    api = {
      getPlantingIntentionsByCustomer: vi.fn((_id: number): Observable<PlantingIntention[]> => of([pi(30)])),
      getStoredGrainByCustomer: vi.fn((id: number): Observable<StoredGrain[]> => of([grain(`g${id}`, id)])),
      getDpContractsByCustomer: vi.fn((id: number): Observable<DpContract[]> => of([dp(`d${id}`, id)])),
      createPlantingIntention: vi.fn((d: { customerId: number; crop: string; plantingYear: number }) =>
        of(pi(700, d.customerId, { crop: d.crop, plantingYear: d.plantingYear }))),
      updatePlantingIntention: vi.fn((id: number, d: { crop: string; acres: number }): Observable<PlantingIntention> =>
        of(pi(id, 1, { crop: d.crop, acres: d.acres }))),
      deletePlantingIntention: vi.fn(() => of(undefined)),
      retagPlantingIntentions: vi.fn(() => of({ moved: 1 })),
      getDashboardPlantingEstimates: vi.fn((_key: string, year: number): Observable<DashboardPlantingEstimate[]> =>
        of([{ crop: 'YC', plantingYear: year } as DashboardPlantingEstimate])),
    };
    // Answers with what was saved, as the server does.
    appApi = {
      saveProducerDetails: vi.fn((id: number, body: { commodities?: string | null }): Observable<ProducerDetails> =>
        of(producerProfile(id, { commodities: body.commodities ?? undefined }))),
    };
    activity = selectedProducerActivityFake();
    // P1's saved details: they grow corn.
    profiles = producerProfilesFake([producerProfile(1, { commodities: 'Corn' })]);
    toast = { success: vi.fn(), error: vi.fn() };
    reporter = { send: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ProducersApiService, useValue: api },
        { provide: ApiService, useValue: appApi },
        provideSelectedProducerActivity(activity),
        provideProducerProfiles(profiles),
        { provide: ToastService, useValue: toast },
        { provide: HandledErrorReporter, useValue: reporter },
        providePermissions(permissionStub(['planting-estimates:read'])),
      ],
    });
    TestBed.inject(TradeUnitContext).setTradeUnits(['TU1']);
    store = TestBed.inject(ProducerProductionStore);
    producers = TestBed.inject(ProducerStore);
    TestBed.tick();
  });

  afterEach(() => vi.useRealTimers());

  describe('selecting a producer', () => {
    it('reads their planting intentions, stored grain and DP contracts', () => {
      store.select(P1);

      expect(shown()).toEqual([30]);
      expect(store.storedGrain().map(row => row.id)).toEqual(['g1']);
      expect(store.dpContracts().map(row => row.id)).toEqual(['d1']);
      expect([store.isLoadingPlanting(), store.isLoadingStoredGrain(), store.isLoadingDpContracts()]).toEqual([false, false, false]);
    });

    // One producer's rows are not the trade units' read: Build a List would filter everyone against them.
    it("merges their stored grain and DP into the trade units' sets, without marking DP read", () => {
      producers.setStoredGrain([grain('g50', 2), grain('g51', 1)]);

      store.select(P1);

      expect(producers.storedGrain().map(row => row.id)).toEqual(['g50', 'g1']);
      expect(producers.dpContracts().map(row => row.id)).toEqual(['d1']);
      expect(producers.dpContractsLoaded()).toBe(false);
    });

    it("shows only the selected producer's rows from the trade units' sets", () => {
      producers.setStoredGrain([grain('g50', 2)]);
      producers.setDpContracts([dp('x', 2)]);

      store.select(P1);

      expect(store.storedGrain().map(row => row.id)).toEqual(['g1']);
      expect(store.dpContracts().map(row => row.id)).toEqual(['d1']);
    });

    it('reads each producer once per trade-unit selection: a later click shows what was read', () => {
      store.select(P1);
      store.select(P2);
      store.select(P1);

      expect(callsFor(api['getPlantingIntentionsByCustomer'], 1)).toBe(1);
      expect(callsFor(api['getStoredGrainByCustomer'], 1)).toBe(1);
      expect(callsFor(api['getDpContractsByCustomer'], 1)).toBe(1);
      expect(shown()).toEqual([30]);
    });

    it('a reread reads their planting again, and keeps what it read', () => {
      store.select(P1);
      store.select(P1, { reread: true });
      expect(callsFor(api['getPlantingIntentionsByCustomer'], 1)).toBe(2);

      store.select(P1);
      expect(callsFor(api['getPlantingIntentionsByCustomer'], 1)).toBe(2);
    });

    it('empties the planting while reading, and the next selection cancels what was being read for the one before', () => {
      const planting = new Subject<PlantingIntention[]>();
      const stored = new Subject<StoredGrain[]>();
      api['getPlantingIntentionsByCustomer'].mockImplementation((id: number) => id === 1 ? planting : of([pi(40, 2)]));
      api['getStoredGrainByCustomer'].mockImplementation((id: number) => id === 1 ? stored : of([grain('g12', 2)]));
      store.select(P2);
      store.select(P1);
      expect(shown()).toEqual([]);
      expect([store.isLoadingPlanting(), store.isLoadingStoredGrain()]).toEqual([true, true]);

      store.select(P2);
      planting.next([pi(99)]);
      stored.next([grain('g99')]);

      expect(shown()).toEqual([40]);
      expect(store.storedGrain().map(row => row.id)).toEqual(['g12']);
      expect(producers.storedGrain().some(row => row.id === 'g99')).toBe(false);
    });

    it('a producer whose reads were cancelled is read again on their next selection', () => {
      api['getStoredGrainByCustomer'].mockReturnValueOnce(NEVER);
      store.select(P1);
      store.select(P2);

      store.select(P1);

      expect(callsFor(api['getStoredGrainByCustomer'], 1)).toBe(2);
    });

    it('a cached producer is not overwritten by an older read landing late', () => {
      store.select(P1);
      const late = new Subject<PlantingIntention[]>();
      api['getPlantingIntentionsByCustomer'].mockReturnValue(late);
      store.select(P2, { reread: true });
      store.select(P1);

      late.next([pi(200, 2)]);

      expect(shown()).toEqual([30]);
    });

    it('no producer: nothing shown and nothing loading', () => {
      api['getPlantingIntentionsByCustomer'].mockReturnValue(NEVER);
      api['getStoredGrainByCustomer'].mockReturnValue(NEVER);
      api['getDpContractsByCustomer'].mockReturnValue(NEVER);
      store.select(P1);

      store.select(null);

      expect(shown()).toEqual([]);
      expect(store.storedGrain()).toEqual([]);
      expect([store.isLoadingPlanting(), store.isLoadingStoredGrain(), store.isLoadingDpContracts()]).toEqual([false, false, false]);
    });

    // Otherwise the Planting tab reads "none" during an outage.
    it('a failed planting read stops the spinner and says so, once every five minutes; App Insights hears of each', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      api['getPlantingIntentionsByCustomer'].mockReturnValue(throwError(() => new Error('500')));

      store.select(P1);
      expect(store.isLoadingPlanting()).toBe(false);
      expect(toast.error).toHaveBeenCalledWith('Failed to load planting intentions. Some data may be missing or out of date.');

      store.select(P2);
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(reporter.send).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(5 * 60_000 + 1);
      store.select(P1);
      expect(toast.error).toHaveBeenCalledTimes(2);
    });

    it('a failure the user was already shown gets no second message', () => {
      const error = new Error('403');
      markShown(error);
      api['getPlantingIntentionsByCustomer'].mockReturnValue(throwError(() => error));

      store.select(P1);

      expect(toast.error).not.toHaveBeenCalled();
      expect(reporter.send).toHaveBeenCalledWith('Producers: failed to load planting intentions', error);
    });
  });

  describe('a new selection of trade units', () => {
    it('reads each producer again for the new scope', () => {
      store.select(P1);

      TestBed.inject(TradeUnitContext).setTradeUnits(['TU1', 'TU2']);
      TestBed.tick();
      store.select(P1);

      expect(callsFor(api['getPlantingIntentionsByCustomer'], 1)).toBe(2);
      expect(callsFor(api['getStoredGrainByCustomer'], 1)).toBe(2);
    });

    it('gives the trade units selected as the ones a new intention may be for', () => {
      expect(store.tradeUnits()).toEqual(['TU1']);
    });
  });

  // The profile surfaces only the two most recent crop years. Producers accumulate seasons forever, and the Planting tab
  // and the Growth Opportunity year picker must agree on which ones exist.
  describe('the crop year', () => {
    const years = (...ys: number[]) => ys.map((y, i) => pi(i + 1, 1, { plantingYear: y }));

    it('offers only the two most recent planting years and their intentions, and looks at the newest', () => {
      api['getPlantingIntentionsByCustomer'].mockReturnValue(of(years(2025, 2026, 2027)));

      store.select(P1);
      TestBed.tick();

      expect(store.plantingYears()).toEqual([2027, 2026]);
      expect(store.visiblePlantingIntentions().map(p => p.plantingYear).sort()).toEqual([2026, 2027]);
      expect(store.selectedPlantingYear()).toBe(2027);
    });

    it('rolls the window forward when a newer year is added', () => {
      api['getPlantingIntentionsByCustomer'].mockReturnValue(of(years(2025, 2026)));
      store.select(P1);
      TestBed.tick();
      expect(store.plantingYears()).toEqual([2026, 2025]);

      store.addPlantingIntention({ crop: 'CORN', acres: 1, plantingYear: 2027, tradeUnit: 'TU1' });
      TestBed.tick();

      expect(store.plantingYears()).toEqual([2027, 2026]);
      expect(store.visiblePlantingIntentions().some(p => p.plantingYear === 2025)).toBe(false);
      expect(store.selectedPlantingYear()).toBe(2027);
    });

    it('falls back to the crop years of their contracts when they have no intentions', () => {
      api['getPlantingIntentionsByCustomer'].mockReturnValue(of([]));
      store.select(P1);
      activity.contracts.set([{ id: 1, cropYear: 2026 }, { id: 2, cropYear: 2024 }, { id: 3, cropYear: 2025 }] as Contract[]);

      expect(store.plantingYears()).toEqual([2026, 2025]);
    });

    it('keeps a picked older year in the list, with its intentions in view', () => {
      api['getPlantingIntentionsByCustomer'].mockReturnValue(of(years(2025, 2026, 2027)));
      store.select(P1);
      TestBed.tick();

      store.selectPlantingYear(2025);
      TestBed.tick();

      expect(store.selectedPlantingYear()).toBe(2025);
      expect(store.plantingYears()).toEqual([2027, 2026, 2025]);
      expect(store.visiblePlantingIntentions().map(p => p.id)).toEqual([1, 2, 3]);
    });

    it('opens on the year a deep link asked for, even with nothing for it, and starts over for the next producer', () => {
      api['getPlantingIntentionsByCustomer'].mockReturnValue(of(years(2026, 2027)));

      store.select(P1, { plantingYear: 2020 });
      TestBed.tick();
      expect(store.selectedPlantingYear()).toBe(2020);
      expect(store.plantingYears()).toEqual([2027, 2026, 2020]);

      store.select(P2);
      TestBed.tick();
      expect(store.selectedPlantingYear()).toBe(2027);
    });

    it('reads the yield estimates of the years offered', () => {
      api['getPlantingIntentionsByCustomer'].mockReturnValue(of(years(2026, 2027)));

      store.select(P1);
      TestBed.tick();

      expect(api['getDashboardPlantingEstimates']).toHaveBeenCalledWith('TU1', 2027);
      expect(api['getDashboardPlantingEstimates']).toHaveBeenCalledWith('TU1', 2026);
      expect(store.yieldEstimates().map(e => e.plantingYear).sort()).toEqual([2026, 2027]);
      expect(store.isLoadingEstimates()).toBe(false);
    });
  });

  it("offers the commodity codes from the producer's tickets and their profile, once each, sorted", () => {
    profiles.put(producerProfile(1, { commodities: 'HRW,YSB' }));
    store.select(P1);
    activity.tickets.set([{ productCode: 'YSB' }, { productCode: 'YC' }, { productCode: '' }, { productCode: 'YC' }] as Ticket[]);

    expect(store.commodityCodes()).toEqual(['HRW', 'YC', 'YSB']);
  });

  describe('writing planting intentions', () => {
    const add = { crop: 'SOYBEANS', acres: 80, plantingYear: 2027, tradeUnit: 'TU1' };

    it("adding puts it in the producer's view, the cache and the trade units' planting, and records the crop on the producer", () => {
      store.select(P1);
      producers.setPlantingIntentions([pi(30), pi(40, 4)]);

      store.addPlantingIntention(add);

      expect(api['createPlantingIntention']).toHaveBeenCalledWith(expect.objectContaining({ customerId: 1, customerCode: 'S-1', crop: 'SOYBEANS' }));
      expect(shown()).toEqual([30, 700]);
      expect(producers.plantingIntentions().map(p => p.id)).toEqual([30, 40, 700]);
      expect(toast.success).toHaveBeenCalledWith('Planting intention added');
      expect(appApi.saveProducerDetails).toHaveBeenCalledWith(1, expect.objectContaining({ commodities: 'Corn,SOYBEANS' }));
      // The new crop shows wherever the producer's details are read.
      expect(profiles.profileOf(1)?.commodities).toBe('Corn,SOYBEANS');

      // The cache has it too: a later click shows it without another read.
      store.select(P2);
      store.select(P1);
      expect(callsFor(api['getPlantingIntentionsByCustomer'], 1)).toBe(1);
      expect(shown()).toEqual([30, 700]);
    });

    it('records no crop the producer already lists, whatever its case', () => {
      store.select(P1);

      store.addPlantingIntention({ ...add, crop: ' corn ' });

      expect(appApi.saveProducerDetails).not.toHaveBeenCalled();
    });

    it('refuses an add with no producer selected', () => {
      store.addPlantingIntention(add);

      expect(api['createPlantingIntention']).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('Select a producer before adding a planting intention.');
    });

    it("editing and deleting update the producer's view, the cache and the trade units' planting", () => {
      api['getPlantingIntentionsByCustomer'].mockReturnValue(of([pi(30), pi(31)]));
      store.select(P1);
      producers.setPlantingIntentions([pi(30), pi(31), pi(40, 4)]);

      store.editPlantingIntention({ intentionId: 30, crop: 'CORN', acres: 55, plantingYear: 2027 });
      store.deletePlantingIntention(31);

      expect(store.plantingIntentions().map(p => [p.id, p.acres])).toEqual([[30, 55]]);
      expect(producers.plantingIntentions().map(p => [p.id, p.acres])).toEqual([[30, 55], [40, 10]]);
      expect(toast.success).toHaveBeenCalledWith('Planting intention updated');
      expect(toast.success).toHaveBeenCalledWith('Planting intention deleted');
      // A crop the producer already lists is not saved again.
      expect(appApi.saveProducerDetails).not.toHaveBeenCalled();

      store.select(P2);
      store.select(P1);
      expect(store.plantingIntentions().map(p => [p.id, p.acres])).toEqual([[30, 55]]);
    });

    it("an add that lands after another producer was picked goes into the first one's cache, not the view", () => {
      const saved = new Subject<PlantingIntention>();
      api['createPlantingIntention'].mockReturnValue(saved);
      store.select(P1);
      store.addPlantingIntention(add);
      api['getPlantingIntentionsByCustomer'].mockReturnValue(of([pi(40, 2)]));
      store.select(P2);

      saved.next(pi(700, 1, { crop: 'SOYBEANS' }));

      expect(shown()).toEqual([40]);
      store.select(P1);
      expect(shown()).toEqual([30, 700]);
    });

    it("reports failed writes with the server's reason where there is one", () => {
      store.select(P1);
      api['createPlantingIntention'].mockReturnValue(throwError(() => new Error('Duplicate crop.')));
      api['updatePlantingIntention'].mockReturnValue(throwError(() => ({})));
      api['deletePlantingIntention'].mockReturnValue(throwError(() => new Error('x')));

      store.addPlantingIntention(add);
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

    it("says so, and reads the producer's intentions again into their view, the cache and the trade units' planting", () => {
      store.select(P1);
      producers.setPlantingIntentions([pi(30), pi(40, 4)]);
      api['retagPlantingIntentions'].mockReturnValue(of({ moved: 2 }));
      api['getPlantingIntentionsByCustomer'].mockReturnValue(of([pi(30, 1, { tradeUnit: 'TU2' })]));

      store.movePlantingIntentions(1, [{ from: 'TU1', to: 'TU2' }]);

      expect(api['retagPlantingIntentions']).toHaveBeenCalledWith(1, 'TU1', 'TU2');
      expect(toast.success).toHaveBeenCalledWith('Moved 2 planting intentions to TU2.');
      expect(store.plantingIntentions()[0].tradeUnit).toBe('TU2');
      expect(producers.plantingIntentions().map(p => [p.id, p.tradeUnit])).toEqual([[40, 'TU1'], [30, 'TU2']]);
    });

    it('reads into the cache even for a producer no longer selected, and says when the read fails', () => {
      store.movePlantingIntentions(1, [{ from: 'TU1', to: 'TU2' }]);
      expect(toast.success).toHaveBeenCalledWith('Moved 1 planting intention to TU2.');
      expect(shown()).toEqual([]);
      store.select(P1);
      expect(api['getPlantingIntentionsByCustomer']).toHaveBeenCalledTimes(1); // served from the move's read

      api['getPlantingIntentionsByCustomer'].mockReturnValue(throwError(() => new Error('500')));
      store.movePlantingIntentions(1, [{ from: 'TU1', to: 'TU2' }]);
      expect(toast.error).toHaveBeenCalledWith('Planting intentions moved, but the list couldn\'t be refreshed — reload the page to see them.');
    });

    it('a failed move names the trade units and moves nothing', () => {
      api['retagPlantingIntentions'].mockReturnValue(throwError(() => new Error('500')));

      store.movePlantingIntentions(1, [{ from: 'TU1', to: 'TU2' }]);

      expect(toast.error).toHaveBeenCalledWith('Couldn\'t move planting intentions from TU1 to TU2 — they\'re still recorded against TU1.');
      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  // A producer's commodities are their saved details, read and saved through ProducerProfiles.
  describe("saving the commodities of the producer's contracts and tickets into their details", () => {
    it("saves the ones their saved details don't list yet", () => {
      store.select(P1);

      activity.tickets.set([{ productCode: 'SB' }] as Ticket[]);
      TestBed.tick();

      expect(appApi.saveProducerDetails).toHaveBeenCalledWith(1, expect.objectContaining({ commodities: 'Corn,SB' }));
      expect(profiles.profileOf(1)?.commodities).toBe('Corn,SB');
    });

    it('saves nothing when their saved details already list every one', () => {
      store.select(P1);

      activity.tickets.set([{ productCode: 'Corn' }] as Ticket[]);
      TestBed.tick();

      expect(appApi.saveProducerDetails).not.toHaveBeenCalled();
    });

    it('saves nothing with no producer selected', () => {
      activity.tickets.set([{ productCode: 'SB' }] as Ticket[]);
      TestBed.tick();

      expect(appApi.saveProducerDetails).not.toHaveBeenCalled();
    });

    // Two saves at once race the server's rebuild of the details' child rows.
    it('saves once at a time: what arrives meanwhile is saved when the first save lands', () => {
      const first = new Subject<ProducerDetails>();
      appApi.saveProducerDetails.mockReturnValueOnce(first);
      store.select(P1);
      activity.tickets.set([{ productCode: 'SB' }] as Ticket[]);
      TestBed.tick();
      activity.contracts.set([{ id: 1, commodityCode: 'WH' }] as Contract[]);
      TestBed.tick();
      expect(appApi.saveProducerDetails).toHaveBeenCalledTimes(1);

      first.next(producerProfile(1, { commodities: 'Corn,SB' }));

      expect(appApi.saveProducerDetails).toHaveBeenCalledTimes(2);
      expect(appApi.saveProducerDetails).toHaveBeenLastCalledWith(1, expect.objectContaining({ commodities: 'Corn,SB,WH' }));
    });
  });

  it("forgets the selection and every producer's reads at sign-out", () => {
    store.select(P1);

    TestBed.inject(SessionReset).reset();

    expect(shown()).toEqual([]);
    store.select(P1);
    expect(callsFor(api['getPlantingIntentionsByCustomer'], 1)).toBe(2);
  });
});
