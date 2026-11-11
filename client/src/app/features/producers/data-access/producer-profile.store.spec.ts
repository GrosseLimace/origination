import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, firstValueFrom, of, throwError } from 'rxjs';
import { ProducerDetails } from '@models';
import { ApiService } from '@core/services/api.service';
import { SessionReset } from '@core/auth/session-reset.service';
import { PermissionStub, permissionStub, providePermissions } from '@testing/permission.stub';
import { producerProfile } from '@testing/producer-profiles.fake';
import { ProducerProfileStore } from './producer-profile.store';

describe('ProducerProfileStore', () => {
  let store: ProducerProfileStore;
  let access: PermissionStub;
  let api: { getAllProducerDetails: ReturnType<typeof vi.fn<() => Observable<ProducerDetails[]>>> };

  beforeEach(() => {
    access = permissionStub(['producer-details:read']);
    api = { getAllProducerDetails: vi.fn(() => of([producerProfile(1, { totalAcres: 900 }), producerProfile(2)])) };
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }, providePermissions(access)] });
    store = TestBed.inject(ProducerProfileStore);
  });

  it("reads every producer's details and keeps them by customer id", async () => {
    expect(store.loaded()).toBe(false);

    const read = await firstValueFrom(store.load());

    expect(read.map(p => p.customerId)).toEqual([1, 2]);
    expect(store.profileOf(1)?.totalAcres).toBe(900);
    expect([...store.profiles().keys()]).toEqual([1, 2]);
    expect(store.loaded()).toBe(true);
  });

  // Nobody else is refused on every trade-unit change.
  it('reads nothing for a user who may not read producer details', async () => {
    access.grant('customers:read');

    expect(await firstValueFrom(store.load())).toEqual([]);
    expect(api.getAllProducerDetails).not.toHaveBeenCalled();
    expect(store.profiles().size).toBe(0);
  });

  // The preload and the home page both ask on the first visit.
  it('shares a read that is already running', () => {
    const answer = new Subject<ProducerDetails[]>();
    api.getAllProducerDetails.mockReturnValue(answer);
    const first = vi.fn();
    const second = vi.fn();

    store.load().subscribe(first);
    store.load().subscribe(second);
    answer.next([producerProfile(1)]);
    answer.complete();

    expect(api.getAllProducerDetails).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith([producerProfile(1)]);
    expect(second).toHaveBeenCalledWith([producerProfile(1)]);

    // Once it has landed, the next ask reads again.
    store.load().subscribe();
    expect(api.getAllProducerDetails).toHaveBeenCalledTimes(2);
  });

  it('replaces what it held with each full read, so deleted details go', async () => {
    await firstValueFrom(store.load());
    api.getAllProducerDetails.mockReturnValue(of([producerProfile(2, { totalAcres: 50 })]));

    await firstValueFrom(store.load());

    expect([...store.profiles().keys()]).toEqual([2]);
    expect(store.profileOf(2)?.totalAcres).toBe(50);
  });

  it('puts in one producer after it is read or saved on its own', async () => {
    await firstValueFrom(store.load());

    store.put(producerProfile(1, { totalAcres: 1200 }));
    store.put(producerProfile(7));

    expect(store.profileOf(1)?.totalAcres).toBe(1200);
    expect([...store.profiles().keys()]).toEqual([1, 2, 7]);
  });

  it('passes a failed read on and keeps what it held', async () => {
    await firstValueFrom(store.load());
    api.getAllProducerDetails.mockReturnValue(throwError(() => new Error('503')));

    await expect(firstValueFrom(store.load())).rejects.toThrow('503');

    expect(store.profileOf(1)?.totalAcres).toBe(900);
    expect(store.loaded()).toBe(true);
  });

  it('drops everything when the session ends, and a read started before then puts nothing back', async () => {
    await firstValueFrom(store.load());
    const late = new Subject<ProducerDetails[]>();
    api.getAllProducerDetails.mockReturnValue(late);
    store.load().subscribe();

    TestBed.inject(SessionReset).reset();
    late.next([producerProfile(1, { totalAcres: 900 })]);

    expect(store.profiles().size).toBe(0);
    expect(store.loaded()).toBe(false);
  });
});
