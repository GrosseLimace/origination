/**
 * Whole-app change-detection guard. Renders the real shell, real routes and real pages under
 * zoneless change detection, with HTTP answered by a small fake backend, and fails if Angular
 * reports NG0103 ("Infinite change detection"). Unit specs mount one component and never see two
 * components keep re-dirtying each other; this caught activity-summary calling markForCheck() inside
 * an effect, which looped as soon as a producer was selected on Home (Dev, 2026-10-14).
 */
import { describe, it, expect } from 'vitest';
import { ErrorHandler, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { HttpResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { of } from 'rxjs';
import { MsalService, MsalBroadcastService, MsalGuard } from '@azure/msal-angular';
import { makeMsalServiceMock, makeMsalBroadcastMock } from '@testing/msal.mocks';
import { AppComponent } from './app.component';
import { routes } from './app.routes';
import { By } from '@angular/platform-browser';
import { HomeComponent } from './features/customers/pages/home/home.component';

const customer = (id: number, name: string) => ({
  id, name, scoularId: `C${id}`, farm: name, location: 'Omaha, NE', phone: '4025551234', email: 'a@b.com',
  totalAcres: 500, linkedProducerIds: [], eSignEnabled: false, achEnabled: false, isActive: true,
  merchandisingCity: 'Omaha', merchandisingStateProvince: 'NE', tradeUnits: ['1084'],
});

function body(url: string): unknown {
  if (url.includes('clienttelemetry')) return { connectionString: null };
  if (url.includes('entitlements/catalog')) return { degraded: false, people: [], tradeUnits: [], groups: [] };
  if (url.includes('mention-catalog')) return { degraded: false, people: [], tradeUnits: [], tradeUnitGroups: [], appGroups: [], teamsChannels: [] };
  if (url.includes('dashboard') && url.includes('summary')) return { estimates: [], marketShares: [], actualHarvest: [] };
  if (url.includes('/version')) return { environment: 'Development' };
  if (/\/customers(\?|$)/.test(url)) return [customer(1, 'Alpha Acres'), customer(2, 'Bravo Grain')];
  if (url.includes('usertradeunits') || url.includes('user-trade-units')) return [{ groupName: 'G', tradeUnitCodes: ['1084'], tradeUnits: [{ code: '1084', description: 'Kansas' }] }];
  if (url.includes('userpreferences')) return { selectedTradeUnits: ['1084'], selectedGroupNames: [] };
  if (url.includes('contracts/customer/')) {
    const id = Number(url.split('customer/')[1].split(/[?/]/)[0]);
    return [1, 2].map(n => ({ id: id * 10 + n, customerId: id, ctrmCustomerId: 'C' + id, sourceContractId: 'PYC' + id + n, farmId: '', contractNumber: 'PYC' + id + n,
      contractPrefixType: 'P', commodityCode: 'YC', commodityDescription: 'Yellow Corn', commodityGroup: 'Corn', tradeUnit: '1084', quantity: 5000 * n, pricedQuantity: 1000,
      unit: 'BU', price: 4.1, cropYear: 2026, openBalanceQuantity: 2000, deliveryStart: '2026-10-01T00:00:00', deliveryEnd: '2026-11-30T00:00:00', status: 'Active', signed: true, priceTypeCode: 'P' }));
  }
  if (url.includes('tickets/customer/')) {
    const id = Number(url.split('customer/')[1].split(/[?/]/)[0]);
    return [1, 2].map(n => ({ id: id * 100 + n, ticketNumber: 'T' + id + n, customerCode: 'C' + id, productCode: 'YC', date: '2026-10-0' + n + 'T00:00:00', netWeight: 56000, isApplied: n === 1,
      ctrmContractNumber: n === 1 ? 'PYC' + id + '1' : null, organizationCode: '1084', appliedNetQuantity: 1000 }));
  }
  if (url.includes('conversions')) return [{ commodityCode: 'YC', lbsPerUnit: 56 }];
  if (url.includes('/me')) return { userId: 'CEgr', displayName: 'Caden', roles: [] };
  return [];
}

const errors: unknown[] = [];

async function settle(fixture: { whenStable(): Promise<unknown> }, ms = 1500) {
  await Promise.race([fixture.whenStable(), new Promise(r => setTimeout(r, ms))]);
}

describe('NG0103 probe', () => {
  it('selects producers on Home without infinite change detection', async () => {
    errors.length = 0;
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter(routes),
        provideHttpClient(withInterceptors([req => of(new HttpResponse({ status: 200, body: body(req.urlWithParams) }))])),
        { provide: MsalService, useValue: makeMsalServiceMock({ name: 'Caden Egr', username: 'CEgr@scoular.com' }) },
        { provide: MsalBroadcastService, useValue: makeMsalBroadcastMock() },
        { provide: MsalGuard, useValue: { canActivate: () => true } },
        { provide: ErrorHandler, useValue: { handleError: (e: unknown) => errors.push(e) } },
      ],
    });
    const fixture = TestBed.createComponent(AppComponent);
    await settle(fixture);
    await TestBed.inject(Router).navigateByUrl('/');
    await settle(fixture, 3000);
    const home = fixture.debugElement.query(By.directive(HomeComponent)).componentInstance as HomeComponent;
    for (const c of [customer(1, 'Alpha Acres'), customer(2, 'Bravo Grain'), customer(1, 'Alpha Acres')]) {
      home.handleSelectCustomer(c as never);
      await settle(fixture, 2500);
    }
    const ng0103 = errors.filter(e => String((e as Error)?.message ?? e).includes('NG0103'));
    const other = errors.filter(e => !String((e as Error)?.message ?? e).includes('NG0103')).map(e => String((e as Error)?.message ?? e).slice(0, 160));
    if (other.length) console.log('[select] other errors:', [...new Set(other)].slice(0, 6));
    if (ng0103.length) console.log('[select] NG0103 x' + ng0103.length);
    expect(ng0103.length).toBe(0);
  }, 60000);

  for (const url of ['/', '/build-list', '/insights', '/dashboard', '/bid-sheet', '/unshipped-bushels', '/daily-digest', '/usage-dashboard', '/whats-new']) {
    it(`renders ${url} without infinite change detection`, async () => {
      errors.length = 0;
      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          provideRouter(routes),
          provideHttpClient(withInterceptors([req => of(new HttpResponse({ status: 200, body: body(req.url) }))])),
          { provide: MsalService, useValue: makeMsalServiceMock({ name: 'Caden Egr', username: 'CEgr@scoular.com' }) },
          { provide: MsalBroadcastService, useValue: makeMsalBroadcastMock() },
          { provide: MsalGuard, useValue: { canActivate: () => true } },
          { provide: ErrorHandler, useValue: { handleError: (e: unknown) => errors.push(e) } },
        ],
      });
      const fixture = TestBed.createComponent(AppComponent);
      await settle(fixture);
      await TestBed.inject(Router).navigateByUrl(url);
      await settle(fixture, 3000);
      await settle(fixture, 1500);
      const ng0103 = errors.filter(e => String((e as Error)?.message ?? e).includes('NG0103'));
      const other = errors.filter(e => !String((e as Error)?.message ?? e).includes('NG0103'))
        .map(e => String((e as Error)?.message ?? e).slice(0, 160));
      if (other.length) console.log(`[${url}] other errors:`, [...new Set(other)].slice(0, 5));
      if (ng0103.length) console.log(`[${url}] NG0103 x${ng0103.length}:`, String((ng0103[0] as Error).stack).slice(0, 1500));
      expect(ng0103.length).toBe(0);
    }, 30000);
  }
});
