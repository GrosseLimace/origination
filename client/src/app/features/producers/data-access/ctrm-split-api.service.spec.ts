import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import type { CtrmSplit } from '../models/field-plan.model';
import { CtrmSplitApiService } from './ctrm-split-api.service';

const URL = `${environment.apiBaseUrl}/ctrm-splits/customer/9`;

const splits: CtrmSplit[] = [
  { splitId: 'TATOB43', primaryCustomerId: 'TATOBIN', name: 'T-A TOBIN - JARBOE WEST', fieldName: 'JARBOE WEST', splitPercent: 100, effectiveDate: '2018-10-01', expired: false, kind: 'Field' },
];

/** Requests start on a microtask (reads happen inside computed signals), so let it run. */
const tick = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe('CtrmSplitApiService', () => {
  let service: CtrmSplitApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(CtrmSplitApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('should load a producer\'s splits once, with where they came from', async () => {
    expect(service.splitsFor(9)).toEqual({ status: 'loading' });
    expect(service.splitsFor(9)).toEqual({ status: 'loading' });
    await tick();
    http.expectOne(URL).flush({ source: 'sample', splits });

    expect(service.splitsFor(9)).toEqual({ status: 'done', source: 'sample', splits });
    await tick();
    http.expectNone(URL);
  });

  it('should say a producer without a CTRM code has no splits to look up, and try again when asked', async () => {
    service.splitsFor(9);
    await tick();
    http.expectOne(URL).flush({ message: 'not found' }, { status: 404, statusText: 'Not Found' });
    expect(service.splitsFor(9)).toEqual({ status: 'error', message: 'This producer has no CTRM code, so their splits can\'t be looked up.' });

    service.retry(9);
    expect(service.splitsFor(9)).toEqual({ status: 'loading' });
    http.expectOne(URL).flush({ source: 'sample', splits });
    expect(service.splitsFor(9).status).toBe('done');
  });

  it('should explain a CTRM outage rather than show no fields', async () => {
    service.splitsFor(9);
    await tick();
    http.expectOne(URL).flush({ message: 'down' }, { status: 503, statusText: 'Service Unavailable' });
    expect(service.splitsFor(9)).toEqual({ status: 'error', message: 'Couldn\'t load the producer\'s splits from CTRM. Try again shortly.' });
  });
});
