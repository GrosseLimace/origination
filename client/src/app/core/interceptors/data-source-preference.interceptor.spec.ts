import { HttpHandler, HttpRequest, HttpResponse } from '@angular/common/http';
import { of } from 'rxjs';
import { DataSourcePreferenceInterceptor } from './data-source-preference.interceptor';
import { DataSourceService } from '@core/services/data-source.service';
import { environment } from '../../../environments/environment';

describe('DataSourcePreferenceInterceptor', () => {
  const sut = new DataSourcePreferenceInterceptor();

  function handlerCapturing(): { handler: HttpHandler; seen: () => HttpRequest<unknown> | undefined } {
    let captured: HttpRequest<unknown> | undefined;
    const handler: HttpHandler = {
      handle: req => { captured = req; return of(new HttpResponse({ status: 200 })); },
    };
    return { handler, seen: () => captured };
  }

  beforeEach(() => localStorage.removeItem(DataSourceService.StorageKey));

  it('adds the preference header to API requests when a preference is stored', () => {
    localStorage.setItem(DataSourceService.StorageKey, 'ctrm');
    const { handler, seen } = handlerCapturing();

    sut.intercept(new HttpRequest('GET', `${environment.apiBaseUrl}/contracts`), handler).subscribe();

    expect(seen()!.headers.get(DataSourceService.Header)).toBe('ctrm');
  });

  it('sends nothing when the user has not chosen', () => {
    const { handler, seen } = handlerCapturing();

    sut.intercept(new HttpRequest('GET', `${environment.apiBaseUrl}/contracts`), handler).subscribe();

    expect(seen()!.headers.has(DataSourceService.Header)).toBe(false);
  });

  it('never sends the header to another origin', () => {
    // Graph and the login endpoints have no business seeing it.
    localStorage.setItem(DataSourceService.StorageKey, 'ctrm');
    const { handler, seen } = handlerCapturing();

    sut.intercept(new HttpRequest('GET', 'https://graph.microsoft.com/v1.0/me'), handler).subscribe();

    expect(seen()!.headers.has(DataSourceService.Header)).toBe(false);
  });
});
