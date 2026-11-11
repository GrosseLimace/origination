import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject, of, throwError } from 'rxjs';
import { Contract } from '@models';
import { environment } from '@env/environment';
import { ContractPacingApiService } from './contract-pacing-api.service';
import { ContractPacingHistoryStore } from './contract-pacing-history.store';

const history = (...ids: number[]) => ids.map(id => ({ id }) as Contract);

describe('ContractPacingHistoryStore', () => {
  let read: ReturnType<typeof vi.fn>;
  let store: ContractPacingHistoryStore;
  const customerId = signal<number | null>(42);

  beforeEach(() => {
    read = vi.fn(() => of(history(1, 2)));
    customerId.set(42);
    TestBed.configureTestingModule({ providers: [{ provide: ContractPacingApiService, useValue: { historicalContracts: read } }] });
    store = TestBed.inject(ContractPacingHistoryStore);
  });

  it("reads a producer's history once, however many pieces of the profile ask", () => {
    store.load(42);
    store.load(42);
    store.load(42);

    expect(read).toHaveBeenCalledTimes(1);
    expect(store.contractsFor(customerId)().map(c => c.id)).toEqual([1, 2]);
    expect(store.failedFor(customerId)()).toBe(false);
  });

  it('reads again for the next producer, and never shows a producer another one\'s history', () => {
    store.load(42);
    const other = signal<number | null>(43);
    expect(store.contractsFor(other)()).toEqual([]);

    read.mockReturnValue(of(history(9)));
    store.load(43);

    expect(read).toHaveBeenLastCalledWith(43);
    expect(store.contractsFor(other)().map(c => c.id)).toEqual([9]);
    expect(store.contractsFor(customerId)()).toEqual([]);
  });

  it('says the history could not be read, for that producer only, and clears it when the next read starts', () => {
    read.mockReturnValue(throwError(() => new Error('CTRM down')));
    store.load(42);
    expect(store.failedFor(customerId)()).toBe(true);
    expect(store.contractsFor(customerId)()).toEqual([]);

    const next$ = new Subject<Contract[]>();
    read.mockReturnValue(next$);
    store.load(43);
    customerId.set(43);
    expect(store.failedFor(customerId)()).toBe(false);
  });

  it('drops a read still in flight when another producer is picked', () => {
    const first$ = new Subject<Contract[]>();
    read.mockReturnValueOnce(first$);
    store.load(42);
    store.load(43);

    first$.next(history(1));

    expect(first$.observed).toBe(false);
    customerId.set(43);
    expect(store.contractsFor(customerId)().map(c => c.id)).toEqual([1, 2]);
  });

  it('reads nothing without a producer', () => {
    store.load(null);
    customerId.set(null);

    expect(read).not.toHaveBeenCalled();
    expect(store.contractsFor(customerId)()).toEqual([]);
  });
});

describe('ContractPacingApiService', () => {
  it("reads a producer's closed contracts from the pacing endpoint", () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const api = TestBed.inject(ContractPacingApiService);
    const http = TestBed.inject(HttpTestingController);
    let received: Contract[] | undefined;

    api.historicalContracts(42).subscribe(contracts => (received = contracts));
    http.expectOne(`${environment.apiBaseUrl}/contracts/pacing/42`).flush(history(5));

    expect(received?.map(c => c.id)).toEqual([5]);
    http.verify();
  });
});
