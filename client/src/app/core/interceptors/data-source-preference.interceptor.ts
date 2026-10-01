import { Injectable } from '@angular/core';
import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Observable } from 'rxjs';
import { DataSourceService } from '@core/services/data-source.service';
import { environment } from '../../../environments/environment';

/**
 * Adds `X-Data-Source-Preference` to every request to our own API when the user has stored a
 * preference between ODS and CTRM. Reads localStorage directly rather than the DataSourceService
 * signals so the first request after a reload already carries the header, and so the interceptor has
 * no dependency on `/api/me` having answered.
 *
 * Sending it for a user the server does not allow-list is harmless: the server ignores it. Not sent to
 * other origins (Graph, login), which have no business seeing it.
 */
@Injectable()
export class DataSourcePreferenceInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (!req.url.startsWith(environment.apiBaseUrl)) return next.handle(req);

    const preference = DataSourceService.readStored();
    if (preference === null) return next.handle(req);

    return next.handle(req.clone({ setHeaders: { [DataSourceService.Header]: preference } }));
  }
}
