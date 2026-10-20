import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import type { Customer, ProducerDetails } from '@models';
import { HomePageState } from './home-page.state';
import { HomeLinkedProducersStore } from './home-linked-producers.store';

const customer = (id: number, linked: string[] = [], over: Partial<Customer> = {}) =>
  ({ id, scoularId: `S-${id}`, name: `P${id}`, linkedProducerIds: linked, ...over }) as Customer;

describe('HomeLinkedProducersStore', () => {
  let store: HomeLinkedProducersStore;
  let page: HomePageState;
  let api: { getCustomerBySourceId: ReturnType<typeof vi.fn>; getCustomersLinkedTo: ReturnType<typeof vi.fn> };
  let onWalked: ReturnType<typeof vi.fn<() => void>>;
  /** The graph the stub API serves: who each source id is, and who links to it. */
  let bySource: Map<string, Customer>;
  let linkedTo: Map<string, Customer[]>;

  beforeEach(() => {
    bySource = new Map();
    linkedTo = new Map();
    api = {
      getCustomerBySourceId: vi.fn((src: string): Observable<Customer | null> => of(bySource.get(src) ?? null)),
      getCustomersLinkedTo: vi.fn((src: string): Observable<Customer[]> => of(linkedTo.get(src) ?? [])),
    };
    TestBed.configureTestingModule({
      providers: [HomePageState, HomeLinkedProducersStore, { provide: ApiService, useValue: api }],
    });
    store = TestBed.inject(HomeLinkedProducersStore);
    page = TestBed.inject(HomePageState);
    onWalked = vi.fn<() => void>();
  });

  const ids = () => store.crossTradeUnitCustomers().map(c => c.id).sort((a, b) => a - b);

  it('fetches only the links not already loaded, plus reverse links, transitively, and reports each level', () => {
    page.customers.set([customer(2)]);
    bySource.set('S-90', customer(90, ['S-91']));
    bySource.set('S-91', customer(91));
    linkedTo.set('S-1', [customer(92, ['S-1'])]);

    store.fetchMissingLinkedProducers(customer(1, ['S-2', 'S-90']), onWalked);

    // S-2 is on the roster; S-1 is fetched while walking 92 because the walked producer itself is not cached.
    expect(api.getCustomerBySourceId.mock.calls.map(c => c[0])).toEqual(['S-90', 'S-91', 'S-1']);
    expect(ids()).toEqual([90, 91, 92]);
    expect(onWalked.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('applies known producer details to what it fetches', () => {
    bySource.set('S-90', customer(90));
    page.producerDetailsMap.set(new Map([[90, { id: 90, customerId: 90, customerName: 'P90', totalAcres: 640 } as ProducerDetails]]));

    store.fetchMissingLinkedProducers(customer(1, ['S-90']), onWalked);

    expect(store.crossTradeUnitCustomers()[0].totalAcres).toBe(640);
  });

  it('walks a producer once until forgetWalks', () => {
    store.fetchMissingLinkedProducers(customer(1), onWalked);
    store.fetchMissingLinkedProducers(customer(1), onWalked);
    expect(api.getCustomersLinkedTo).toHaveBeenCalledTimes(1);

    store.forgetWalks();
    store.fetchMissingLinkedProducers(customer(1), onWalked);
    expect(api.getCustomersLinkedTo).toHaveBeenCalledTimes(2);
  });

  it('skips the network for a producer with no scoularId and nothing missing', () => {
    store.fetchMissingLinkedProducers(customer(1, [], { scoularId: undefined }), onWalked);
    expect(api.getCustomersLinkedTo).not.toHaveBeenCalled();
    expect(onWalked).not.toHaveBeenCalled();
  });

  it('treats a failed outgoing read as missing and still keeps the reverse links', () => {
    api.getCustomerBySourceId.mockReturnValue(throwError(() => new Error('500')));
    linkedTo.set('S-1', [customer(92)]);
    store.fetchMissingLinkedProducers(customer(1, ['S-90']), onWalked);
    expect(ids()).toEqual([92]);
  });

  it('never adds the producer itself from its own reverse links', () => {
    linkedTo.set('S-1', [customer(1), customer(92)]);
    store.fetchMissingLinkedProducers(customer(1), onWalked);
    expect(ids()).toEqual([92]);
  });

  it('is cancelled by a new selection, and an unfinished walk is not marked done', () => {
    const answer = new Subject<Customer[]>();
    api.getCustomersLinkedTo.mockReturnValue(answer);
    store.fetchMissingLinkedProducers(customer(1), onWalked);

    page.cancelSelection$.next();
    answer.next([customer(92)]);
    answer.complete();
    expect(ids()).toEqual([]);

    api.getCustomersLinkedTo.mockReturnValue(of([]));
    store.fetchMissingLinkedProducers(customer(1), onWalked);
    expect(api.getCustomersLinkedTo).toHaveBeenCalledTimes(2);
  });

  it('stops after 25 producers in one walk', () => {
    // A chain 1 -> 2 -> 3 -> ... where every producer is only reachable by fetching it.
    for (let i = 2; i <= 40; i++) bySource.set(`S-${i}`, customer(i, [`S-${i + 1}`]));
    store.fetchMissingLinkedProducers(customer(1, ['S-2']), onWalked);
    expect(ids().length).toBe(25);
  });
});
