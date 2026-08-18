import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AppStateService } from './app-state.service';
import { DpContract } from '@models';

function dpRow(over: Partial<DpContract> = {}): DpContract {
  return {
    id: 'r1', ticketKey: 't1', ticketNumber: '100', contractNumber: 'PCPL1',
    contractPrefixType: 'P', contractPrefixCommodity: 'C', contractSuffix: '', ticketStatus: 'U/L',
    customerId: 1, customerCode: 'CUST1', tradeUnitCode: '1085', crop: 'YSB',
    quantity: 100, grossQuantity: 100, quantityUom: 'BU', bushels: 100,
    storageDays: 10, decideFreeDays: 0, storageRate: 0.002,
    receivableAmount: 5, prepaidAmount: 0, unearnedStorageAmount: 0, unpaidHandlingAmount: 0,
    storageStartDate: null, chargedFromDate: null, chargedThruDate: null,
    paidThruDate: null, bolDate: null,
    status: 'S', statusDescription: 'REGULAR STG RATE', storageProgramCode: 'D26',
    storageErrorFlag: '', storageErrorDescription: '',
    ...over,
  };
}

/**
 * The DP loaded-flag is the thing that tells consumers "a fetch finished for the CURRENT trade
 * units". It must not survive a trade-unit change: leaving it set made Build A List filter a new TU's
 * producers against the previous TU's DP rows and honestly report "no producers match".
 */
describe('AppStateService — DP cache invalidation', () => {
  let svc: AppStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [AppStateService] });
    svc = TestBed.inject(AppStateService);
  });

  it('starts not-loaded', () => {
    expect(svc.dpContractsLoaded()).toBe(false);
    expect(svc.dpContracts()).toEqual([]);
  });

  it('marks loaded once a fetch completes, even with zero rows', () => {
    // A TU with genuinely no DP must still count as loaded, or consumers wait forever.
    svc.setDpContracts([]);

    expect(svc.dpContractsLoaded()).toBe(true);
  });

  it('marks loaded and stores rows on a populated fetch', () => {
    svc.setDpContracts([dpRow()]);

    expect(svc.dpContractsLoaded()).toBe(true);
    expect(svc.dpContracts()).toHaveLength(1);
  });

  it('clearDpContractsCache drops both the rows and the loaded flag', () => {
    svc.setDpContracts([dpRow()]);

    svc.clearDpContractsCache();

    expect(svc.dpContracts()).toEqual([]);
    expect(svc.dpContractsLoaded()).toBe(false);
  });

  it('a per-producer merge does NOT claim a TU-wide load', () => {
    // The original "no producers match" cause: opening one producer fetched their DP and marked the
    // whole trade unit loaded, so Build A List filtered everyone against that single producer's rows.
    svc.mergeCustomerDpContracts(1, [dpRow({ customerId: 1 })]);

    expect(svc.dpContracts()).toHaveLength(1);
    expect(svc.dpContractsLoaded()).toBe(false);
  });

  it('a per-producer merge replaces only that producer and keeps the others', () => {
    svc.setDpContracts([
      dpRow({ id: 'a', ticketKey: 'a', customerId: 1 }),
      dpRow({ id: 'b', ticketKey: 'b', customerId: 2 }),
    ]);

    svc.mergeCustomerDpContracts(1, [dpRow({ id: 'a2', ticketKey: 'a2', customerId: 1 })]);

    const rows = svc.dpContracts();
    expect(rows).toHaveLength(2);
    expect(rows.filter(r => r.customerId === 1).map(r => r.id)).toEqual(['a2']);
    expect(rows.filter(r => r.customerId === 2).map(r => r.id)).toEqual(['b']);
  });

  it('a per-producer merge leaves an existing TU-wide load flagged', () => {
    svc.setDpContracts([dpRow({ customerId: 2 })]);

    svc.mergeCustomerDpContracts(1, [dpRow({ id: 'x', ticketKey: 'x', customerId: 1 })]);

    expect(svc.dpContractsLoaded()).toBe(true); // a real TU-wide load already happened
  });

  it('a cleared cache reports not-loaded so consumers re-fetch rather than reuse stale rows', () => {
    // The exact regression: TU A loads, TU B is selected, and a DP query must NOT see TU A's rows.
    svc.setDpContracts([dpRow({ tradeUnitCode: '1085' })]);
    expect(svc.dpContractsLoaded()).toBe(true);

    svc.clearDpContractsCache();          // what the preload now does on TU change

    expect(svc.dpContractsLoaded()).toBe(false);
    expect(svc.dpContracts()).toEqual([]);
  });
});
