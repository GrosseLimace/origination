import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NavigationEnd, NavigationStart, Router, Event as RouterEvent } from '@angular/router';
import { Subject } from 'rxjs';
import { environment } from '@env/environment';
import { UsageTrackingService } from './usage-tracking.service';

/**
 * Fire-and-forget usage events. Pins:
 *  - a screen_enter is posted for each mapped route on NavigationEnd (query string ignored), using the
 *    feature codes the backend's FeatureNameMapper expects,
 *  - the usage dashboard itself, unmapped routes and non-NavigationEnd events post nothing,
 *  - optional sub-feature / target ids go up as explicit nulls,
 *  - a failing POST is swallowed (tracking must never surface an error to the user).
 */
const URL = `${environment.apiBaseUrl}/usage-dashboard/click-event`;

describe('UsageTrackingService', () => {
  let service: UsageTrackingService;
  let http: HttpTestingController;
  let routerEvents: Subject<RouterEvent>;

  const navigateTo = (urlAfterRedirects: string): void =>
    routerEvents.next(new NavigationEnd(1, urlAfterRedirects, urlAfterRedirects));

  beforeEach(() => {
    routerEvents = new Subject<RouterEvent>();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { events: routerEvents } },
      ],
    });
    service = TestBed.inject(UsageTrackingService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it.each([
    ['/', 'customers'],
    ['/build-list', 'build-a-list'],
    ['/insights', 'insights'],
    ['/dashboard', 'dashboard'],
    ['/bid-sheet', 'bidsheet'],
    ['/unshipped-bushels', 'unshipped-bushels'],
    ['/daily-digest', 'daily-recap'],
  ])('posts screen_enter for %s as feature "%s"', (path, featureCode) => {
    navigateTo(path);

    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ eventType: 'screen_enter', featureCode, subFeatureCode: null, targetId: null });
    req.flush(null);
  });

  it('ignores the query string when mapping the route', () => {
    navigateTo('/build-list?list=42&tab=map');

    expect(http.expectOne(URL).request.body.featureCode).toBe('build-a-list');
  });

  it('does not track entering the usage dashboard itself', () => {
    navigateTo('/usage-dashboard');
    http.expectNone(URL);
  });

  it('does not track unmapped routes or child paths', () => {
    navigateTo('/whats-new');
    navigateTo('/dashboard/extra');
    http.expectNone(URL);
  });

  it('only reacts to NavigationEnd, not the start of a navigation', () => {
    routerEvents.next(new NavigationStart(1, '/insights'));
    http.expectNone(URL);
  });

  it('sends the sub-feature and target for customer interactions', () => {
    service.trackCallClick('123');

    expect(http.expectOne(URL).request.body).toEqual({
      eventType: 'call_click', featureCode: 'customers', subFeatureCode: 'customer-details', targetId: '123',
    });
  });

  it('sends a null target when an optional id is omitted', () => {
    service.trackContractExpand();

    expect(http.expectOne(URL).request.body).toEqual({
      eventType: 'interaction', featureCode: 'customers', subFeatureCode: 'contracts', targetId: null,
    });
  });

  it('records map links as the generic interaction type so the dashboard still counts them', () => {
    service.trackMapClick('7');
    service.trackBinSiteMapClick('7');

    const [address, binSite] = http.match(URL);
    expect(address.request.body.eventType).toBe('interaction');
    expect(address.request.body.subFeatureCode).toBe('map-click');
    expect(binSite.request.body.eventType).toBe('interaction');
    expect(binSite.request.body.subFeatureCode).toBe('bin-site-map-click');
  });

  it('swallows a failing POST', () => {
    service.trackWhatsNewOpened();

    // flush with an error status: if the error escaped, the subscription would throw here.
    expect(() => http.expectOne(URL).flush('boom', { status: 500, statusText: 'Server Error' })).not.toThrow();
  });
});
