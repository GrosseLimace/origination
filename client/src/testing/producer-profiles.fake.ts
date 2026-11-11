import { Provider, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { vi } from 'vitest';
import { ProducerDetails } from '@models';
import { ProducerProfiles } from '@core/context/producer-profiles';

/** One producer's saved details for a spec: the given fields on top of an otherwise empty record. */
export function producerProfile(customerId: number, over: Partial<ProducerDetails> = {}): ProducerDetails {
  return { id: customerId, customerId, customerName: '', createdBy: '', createdAt: '', ...over };
}

/** Producers' saved details by customer id, as ProducerProfiles.profiles() holds them. */
export function profileMap(...profiles: ProducerDetails[]): ReadonlyMap<number, ProducerDetails> {
  return new Map(profiles.map(p => [p.customerId, p]));
}

/** The saved details given to spec customers with withProfile, kept beside each customer object. */
const attached = new WeakMap<object, ProducerDetails>();

/**
 * Gives a spec's customer saved details and returns the customer. They are kept beside that object, not by id, so two
 * tests can each build a customer 5 with different details.
 */
export function withProfile<T extends { id: number }>(customer: T, over: Partial<ProducerDetails>): T {
  attached.set(customer, producerProfile(customer.id, over));
  return customer;
}

/** The saved details withProfile gave these customers, by id, as ProducerProfiles.profiles() holds them. */
export function profilesOf(customers: readonly { id: number }[]): ReadonlyMap<number, ProducerDetails> {
  return profileMap(...customers.flatMap(c => attached.get(c) ?? []));
}

/**
 * A ProducerProfiles for specs: the profiles are a writable signal a test sets directly (or through `set`), `put`
 * writes into it as the store does, and `load` is a spy that emits the profiles held, unless a test makes it return
 * something else. Starts with no profiles, not yet loaded.
 */
export function producerProfilesFake(initial: readonly ProducerDetails[] = []) {
  const profiles = signal<ReadonlyMap<number, ProducerDetails>>(new Map(initial.map(d => [d.customerId, d])));
  const loaded = signal(false);
  return {
    profiles,
    loaded,
    profileOf: (customerId: number) => profiles().get(customerId),
    load: vi.fn((): Observable<ProducerDetails[]> => of([...profiles().values()])),
    put: vi.fn((details: ProducerDetails) => profiles.update(held => new Map(held).set(details.customerId, details))),
    /** Replaces every profile, as a landed read does. */
    set: (details: readonly ProducerDetails[]) => {
      profiles.set(new Map(details.map(d => [d.customerId, d])));
      loaded.set(true);
    },
  } satisfies ProducerProfiles & Record<string, unknown>;
}

export type ProducerProfilesFake = ReturnType<typeof producerProfilesFake>;

/** Provides `fake` (or an empty one) as the ProducerProfiles. */
export function provideProducerProfiles(fake: ProducerProfilesFake = producerProfilesFake()): Provider {
  return { provide: ProducerProfiles, useValue: fake };
}
