import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '@env/environment';
import { injectApiErrorHandler } from '@core/http/api-error-handler';
import { RecapGroup, RecapGroupSaveRequest } from '../models/recap-group.model';

/** A recap group as the server sends it: an int id, and the CC list under ccList. */
type RecapGroupDto = RecapGroup & { id: number | string; ccList?: string[] };

/** The Engagement module's Daily Recap groups API: the Daily Digest page, and the bid sheet's share dialog. */
@Injectable({ providedIn: 'root' })
export class RecapGroupsApiService {
  private readonly http = inject(HttpClient);
  private readonly handleError = injectApiErrorHandler();
  private readonly baseUrl = environment.apiBaseUrl;

  // ---------------------------------------------------------------------------
  // Daily Recap Groups (Daily Digest). Any member may edit a group, not just its creator; only
  // DELETE is creator-only. The server uses an int PK; the frontend model carries id as a string,
  // so map across the boundary.
  // ---------------------------------------------------------------------------

  /** Shapes a server RecapGroupDto into the frontend RecapGroup (int id -> string). */
  private mapRecapGroup(
    dto: RecapGroupDto,
  ): RecapGroup {
    return {
      id: String(dto.id),
      name: dto.name,
      deliveryMethod: dto.deliveryMethod,
      members: dto.members ?? [],
      ccList: dto.ccList ?? [],
      teamsChannelEmail: dto.teamsChannelEmail,

      enabled: dto.enabled,
      // Both flags are server-computed on every response now, including create/update. The `?? true`
      // fallbacks only cover a response shape older than this client.
      isOwner: dto.isOwner ?? true,
      canEdit: dto.canEdit ?? true,
      createdBy: dto.createdBy ?? '',
    };
  }

  /** Builds the API request body from a save request (members -> {type,id,name,email}, ccList -> ccEmails).
   *  `enabled` is sent on CREATE only — after that the card's toggle endpoint owns it. The update
   *  endpoint ignores the field today; omitting it means a future change that starts honouring it
   *  can't silently switch off an existing group's recap. */
  private toRecapGroupBody(
    req: RecapGroupSaveRequest,
    isCreate: boolean,
  ) {
    return {
      name: req.name,
      deliveryMethod: req.deliveryMethod,
      teamsChannelEmail: req.deliveryMethod === 'teams' ? req.teamsChannelEmail : undefined,
      members: req.members.map(m => ({ type: m.type, id: m.id, name: m.name, email: m.email })),
      ccEmails: req.ccList,
      enabled: isCreate ? (req.enabled ?? false) : undefined,
    };
  }

  /** Fetches the current user's recap groups. */
  getRecapGroups(): Observable<RecapGroup[]> {
    return this.http.get<RecapGroupDto[]>(`${this.baseUrl}/dailyrecapgroups`)
      .pipe(
        map(list => list.map(g => this.mapRecapGroup(g))),
        catchError(e => this.handleError(e)),
      );
  }

  /** Creates a new recap group. */
  createRecapGroup(
    req: RecapGroupSaveRequest,
  ): Observable<RecapGroup> {
    return this.http.post<RecapGroupDto>(`${this.baseUrl}/dailyrecapgroups`, this.toRecapGroupBody(req, true))
      .pipe(map(g => this.mapRecapGroup(g)), catchError(e => this.handleError(e)));
  }

  /** Updates an existing recap group. */
  updateRecapGroup(
    id: string,
    req: RecapGroupSaveRequest,
  ): Observable<RecapGroup> {
    return this.http.put<RecapGroupDto>(`${this.baseUrl}/dailyrecapgroups/${Number(id)}`, this.toRecapGroupBody(req, false))
      .pipe(map(g => this.mapRecapGroup(g)), catchError(e => this.handleError(e)));
  }

  /** Toggles a recap group's enabled flag. */
  setRecapGroupEnabled(
    id: string,
    enabled: boolean,
  ): Observable<RecapGroup> {
    return this.http.put<RecapGroupDto>(`${this.baseUrl}/dailyrecapgroups/${Number(id)}/enabled`, { enabled })
      .pipe(map(g => this.mapRecapGroup(g)), catchError(e => this.handleError(e)));
  }

  /** Deletes a recap group (cascade removes members + CC emails). */
  deleteRecapGroup(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/dailyrecapgroups/${Number(id)}`)
      .pipe(catchError(e => this.handleError(e)));
  }
}
