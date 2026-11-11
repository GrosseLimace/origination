import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { RefinementFilters } from '../models/refine-filters.model';
import { environment } from '@env/environment';
import { injectApiErrorHandler } from '@core/http/api-error-handler';
import { dedupeRequests } from '@core/http/dedupe-requests';
import { QueryLibraryItem } from '../models/query-library.model';
import { SavedList, TeamMember } from '../models/saved-list.model';

/** A saved list as the server sends it: the three JSON columns arrive as strings. */
type SavedListDto = Omit<SavedList, 'filters' | 'includedCustomerIds' | 'excludedCustomerIds'> & {
  filters?: string | null;
  includedCustomerIds?: string | null;
  excludedCustomerIds?: string | null;
};

/** What a saved list's create or update sends. */
export interface SavedListBody {
  name: string;
  query: string;
  tradeUnits?: string;
  filters?: RefinementFilters;
  includedCustomerIds?: number[];
  excludedCustomerIds?: number[];
}

/** The Lists module's API: saved lists, the team's lists and members, and the query library. */
@Injectable({ providedIn: 'root' })
export class SavedListsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly dedupe = dedupeRequests();
  private readonly handleError = injectApiErrorHandler();

  // ==========================================================================
  // Query library
  // ==========================================================================

  /** Fetches all active query library items, sorted by category then sort order. */
  getQueryLibrary(): Observable<QueryLibraryItem[]> {
    return this.http.get<QueryLibraryItem[]>(`${this.baseUrl}/query-library`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Logs a query library search for gap analysis. Fire-and-forget. */
  logQuerySearch(searchText: string, matchedQueryId?: number): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/query-library/search-log`, {
      searchText,
      matchedQueryId: matchedQueryId ?? null
    }).pipe(catchError(() => of(undefined as unknown as void)));
  }

  // ==========================================================================
  // Saved lists
  // ==========================================================================

  /** The saved-list columns that arrive as JSON strings and have to come back as objects. Both
   *  read paths used to declare their own identical parseJson closure, and all three write paths
   *  their own identical stringify block — so a change to how a list is shaped had four places to
   *  land and no way to tell you when it only reached three. */
  private static parseSavedListJson<T>(val: string | null | undefined): T | undefined {
    if (!val) return undefined;
    try { return JSON.parse(val) as T; } catch { return undefined; }
  }

  private static hydrateSavedList(l: SavedListDto): SavedList {
    return {
      ...l,
      filters: SavedListsApiService.parseSavedListJson<RefinementFilters>(l.filters),
      includedCustomerIds: SavedListsApiService.parseSavedListJson<number[]>(l.includedCustomerIds),
      excludedCustomerIds: SavedListsApiService.parseSavedListJson<number[]>(l.excludedCustomerIds),
    };
  }

  /** Inverse of hydrateSavedList — empty collections and empty filter objects go as null so the
   *  server stores "unset" rather than "[]", which the read side would hand back as an empty
   *  array and the NLQ path treats differently from undefined. */
  private static toSavedListPayload<T extends {
    filters?: RefinementFilters;
    includedCustomerIds?: number[];
    excludedCustomerIds?: number[];
  }>(data: T) {
    return {
      ...data,
      filters: data.filters && Object.keys(data.filters).length > 0 ? JSON.stringify(data.filters) : null,
      includedCustomerIds: data.includedCustomerIds?.length ? JSON.stringify(data.includedCustomerIds) : null,
      excludedCustomerIds: data.excludedCustomerIds?.length ? JSON.stringify(data.excludedCustomerIds) : null,
    };
  }

  /** Fetches all saved customer lists — deserializes JSON strings to objects */
  getSavedLists(): Observable<SavedList[]> {
    return this.dedupe('savedlists',
      this.http.get<SavedListDto[]>(`${this.baseUrl}/savedlists`).pipe(
        map(lists => lists.map(SavedListsApiService.hydrateSavedList)),
        catchError(e => this.handleError(e))
      )
    );
  }

  /** Manager-only: fetches all saved lists tied to the given trade unit(s) that belong to other
   *  users, each carrying the creator's display name. Same JSON deserialization as getSavedLists. */
  getTeamSavedLists(tradeUnits: string): Observable<SavedList[]> {
    return this.http.get<SavedListDto[]>(`${this.baseUrl}/savedlists/team`, { params: { tradeUnits } }).pipe(
      map(lists => lists.map(SavedListsApiService.hydrateSavedList)),
      catchError(e => this.handleError(e))
    );
  }

  /** Creates a new saved list */
  createSavedList(data: SavedListBody): Observable<SavedList> {
    return this.http.post<SavedList>(`${this.baseUrl}/savedlists`, SavedListsApiService.toSavedListPayload(data))
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Updates an existing saved list by ID */
  updateSavedList(id: number, data: SavedListBody): Observable<SavedList> {
    return this.http.put<SavedList>(`${this.baseUrl}/savedlists/${id}`, SavedListsApiService.toSavedListPayload(data))
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Deletes a saved list by ID */
  deleteSavedList(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/savedlists/${id}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Manager-only: team members in the given trade unit(s) for the "assign a list" picker. */
  getTeamMembers(tradeUnits: string): Observable<TeamMember[]> {
    return this.http.get<TeamMember[]>(`${this.baseUrl}/savedlists/team-members`, { params: { tradeUnits } })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Manager-only: assigns a copy of a built list to one or more team members (one copy each). */
  assignSavedList(data: SavedListBody & { targetUserIds: string[] }): Observable<SavedList[]> {
    // targetUserIds rides along untouched — the payload helper only reshapes the three JSON columns.
    return this.http.post<SavedList[]>(`${this.baseUrl}/savedlists/assign`, SavedListsApiService.toSavedListPayload(data))
      .pipe(catchError(e => this.handleError(e)));
  }
}
