import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NEVER, Observable, Subject, of, throwError } from 'rxjs';
import { SessionReset } from '@core/auth/session-reset.service';
import { CustomerStore } from './customer.store';
import { CustomersApiService } from './customers-api.service';
import type { Customer } from '@models';
import { ProducerProfilesFake, producerProfile, producerProfilesFake, provideProducerProfiles } from '@testing/producer-profiles.fake';
import { LinkedProducersStore } from './linked-producers.store';

/** Every producer's saved details, as the walk reads their links; made fresh for each test. */
let profiles: ProducerProfilesFake;

/** A producer, whose saved details link to `linked`. */
const customer = (id: number, linked: string[] = [], over: Partial<Customer> = {}) => {
  if (linked.length > 0) profiles.put(producerProfile(id, { linkedProducerIds: linked.join(',') }));
  return ({ id, scoularId: `S-${id}`, name: `P${id}`, ...over }) as Customer;
};

describe('LinkedProducersStore', () => {
  let store: LinkedProducersStore;
  let roster: CustomerStore;
  let api: { getCustomerBySourceId: ReturnType<typeof vi.fn>; getCustomersLinkedTo: ReturnType<typeof vi.fn> };
  /** The page's next selection. */
  let cancel$: Subject<void>;
  /** The graph the stub API serves: who each source id is, and who links to it. */
  let bySource: Map<string, Customer>;
  let linkedTo: Map<string, Customer[]>;

  beforeEach(() => {
    bySource = new Map();
    profiles = producerProfilesFake();
    linkedTo = new Map();
    api = {
      getCustomerBySourceId: vi.fn((src: string): Observable<Customer | null> => of(bySource.get(src) ?? null)),
      getCustomersLinkedTo: vi.fn((src: string): Observable<Customer[]> => of(linkedTo.get(src) ?? [])),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: CustomersApiService, useValue: api }, provideProducerProfiles(profiles)],
    });
    store = TestBed.inject(LinkedProducersStore);
    roster = TestBed.inject(CustomerStore);
    cancel$ = new Subject<void>();
  });

  const ids = () => store.crossTradeUnitCustomers().map(c => c.id).sort((a, b) => a - b);

  it("fetches only the links not on the trade units' roster or held already, plus reverse links, transitively", () => {
    roster.setCustomers([customer(2)]);
    bySource.set('S-90', customer(90, ['S-91']));
    bySource.set('S-91', customer(91));
    linkedTo.set('S-1', [customer(92, ['S-1'])]);

    store.fetchMissingLinkedProducers(customer(1, ['S-2', 'S-90']), cancel$);

    // S-2 is on the roster; S-1 is fetched while walking 92 because the walked producer itself is not cached.
    expect(api.getCustomerBySourceId.mock.calls.map(c => c[0])).toEqual(['S-90', 'S-91', 'S-1']);
    expect(ids()).toEqual([90, 91, 92]);
  });

  // Their details stay in ProducerProfiles, where every piece of the screen reads them.
  it('keeps the producers it fetches as the API gives them', () => {
    const fetched = customer(90);
    bySource.set('S-90', fetched);

    store.fetchMissingLinkedProducers(customer(1, ['S-90']), cancel$);

    expect(store.crossTradeUnitCustomers()).toEqual([fetched]);
  });

  it('walks a producer once until forgetWalks', () => {
    store.fetchMissingLinkedProducers(customer(1), cancel$);
    store.fetchMissingLinkedProducers(customer(1), cancel$);
    expect(api.getCustomersLinkedTo).toHaveBeenCalledTimes(1);

    store.forgetWalks();
    store.fetchMissingLinkedProducers(customer(1), cancel$);
    expect(api.getCustomersLinkedTo).toHaveBeenCalledTimes(2);
  });

  it('skips the network for a producer with no scoularId and nothing missing', () => {
    store.fetchMissingLinkedProducers(customer(1, [], { scoularId: undefined }), cancel$);
    expect(api.getCustomersLinkedTo).not.toHaveBeenCalled();
  });

  it('treats a failed outgoing read as missing and still keeps the reverse links', () => {
    api.getCustomerBySourceId.mockReturnValue(throwError(() => new Error('500')));
    linkedTo.set('S-1', [customer(92)]);
    store.fetchMissingLinkedProducers(customer(1, ['S-90']), cancel$);
    expect(ids()).toEqual([92]);
  });

  it('never adds the producer itself from its own reverse links', () => {
    linkedTo.set('S-1', [customer(1), customer(92)]);
    store.fetchMissingLinkedProducers(customer(1), cancel$);
    expect(ids()).toEqual([92]);
  });

  it('is cancelled by a new selection, and an unfinished walk is not marked done', () => {
    const answer = new Subject<Customer[]>();
    api.getCustomersLinkedTo.mockReturnValue(answer);
    store.fetchMissingLinkedProducers(customer(1), cancel$);

    cancel$.next();
    answer.next([customer(92)]);
    answer.complete();
    expect(ids()).toEqual([]);

    api.getCustomersLinkedTo.mockReturnValue(of([]));
    store.fetchMissingLinkedProducers(customer(1), cancel$);
    expect(api.getCustomersLinkedTo).toHaveBeenCalledTimes(2);
  });

  it('stops after 25 producers in one walk', () => {
    // A chain 1 -> 2 -> 3 -> ... where every producer is only reachable by fetching it.
    for (let i = 2; i <= 40; i++) bySource.set(`S-${i}`, customer(i, [`S-${i + 1}`]));
    store.fetchMissingLinkedProducers(customer(1, ['S-2']), cancel$);
    expect(ids().length).toBe(25);
  });

  it("gives each producer's linked group among the roster and the producers held, by their saved links", () => {
    const one = customer(1, ['S-2']);
    roster.setCustomers([one, customer(2), customer(3)]);
    store.put(customer(90, ['S-1']));

    expect(store.groupOf(one).map(c => c.id).sort((a, b) => a - b)).toEqual([2, 90]);
  });

  it('puts in and refreshes the producers it holds; a refresh leaves out one not held', () => {
    store.put(customer(90));
    store.refresh({ ...customer(90), name: 'Renamed' });
    store.refresh(customer(91));

    expect(store.crossTradeUnitCustomers().map(c => [c.id, c.name])).toEqual([[90, 'Renamed']]);
  });

  it('a trade-unit change, or sign-out, drops the producers held and the walks done', () => {
    store.fetchMissingLinkedProducers(customer(1), cancel$);
    store.put(customer(90));

    store.clear();
    expect(ids()).toEqual([]);
    store.fetchMissingLinkedProducers(customer(1), cancel$);
    expect(api.getCustomersLinkedTo).toHaveBeenCalledTimes(2);

    store.put(customer(90));
    api.getCustomersLinkedTo.mockReturnValue(NEVER);
    TestBed.inject(SessionReset).reset();
    expect(ids()).toEqual([]);
  });
});
