import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { BidSheet, BidSheetLocation, BidSheetPreferenceRead, BidSheetPreferenceUpdate } from '../models/bid-sheet.model';
import { BarchartCatalogLocation, BarchartCatalogLocationDetail, BarchartCoverage, BarchartLocationSearchParams } from '../models/barchart.model';
import { environment } from '@env/environment';
import { injectApiErrorHandler } from '@core/http/api-error-handler';
import { dedupeRequests } from '@core/http/dedupe-requests';

/** The Bid Sheet module's API: locations and their bids, the saved preference, sheets, and the BarChart catalog. */
@Injectable({ providedIn: 'root' })
export class BidSheetApiService {
  private readonly http = inject(HttpClient);
  private readonly handleError = injectApiErrorHandler();
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly _dedupe = dedupeRequests();

  // =========================================================================
  // Bid Sheet Operations
  // =========================================================================

  /** Gets all bid sheet locations across all trade units (for map display) */
  getAllBidSheetLocations(): Observable<BidSheetLocation[]> {
    return this._dedupe('bidsheet-all-locations',
      this.http.get<BidSheetLocation[]>(`${this.baseUrl}/bidsheet/locations`)
        .pipe(catchError(e => this.handleError(e)))
    );
  }

  /** Creates a new bid sheet location with initial bids */
  createBidSheetLocation(location: {
    name?: string; address?: string; city?: string; state?: string;
    latitude?: number; longitude?: number; elevatorCode?: string;
    /** Links this placement to a BarChart listing; the server prefills details and pulls its bids in. */
    barchartLocationKey?: string;
    tradeUnitCode?: string; groupName?: string; isScoularFacility?: boolean;
    bids: Array<{ commodityCode: string; commodityName?: string; commodityCategory?: string; cropYear: number; bid: string }>;
  }): Observable<BidSheetLocation> {
    return this.http.post<BidSheetLocation>(`${this.baseUrl}/bidsheet/locations`, location)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Updates a bid sheet location's metadata */
  updateBidSheetLocation(id: number, location: Partial<BidSheetLocation>): Observable<BidSheetLocation> {
    return this.http.put<BidSheetLocation>(`${this.baseUrl}/bidsheet/locations/${id}`, location)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Deletes a bid sheet location and all its bids */
  deleteBidSheetLocation(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/bidsheet/locations/${id}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Deletes all bids for a specific commodity on a location */
  deleteBidSheetBids(locationId: number, commodityCode: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/bidsheet/locations/${locationId}/bids/${encodeURIComponent(commodityCode)}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Bulk upserts bids (used by the edit-bids grid) */
  bulkUpsertBidSheetBids(bids: Array<{
    locationId?: number; name?: string; elevatorCode?: string; tradeUnitCode?: string; groupName?: string;
    latitude?: number; longitude?: number;
    commodityCode: string; commodityName?: string; commodityCategory?: string;
    cropYear: number; bid: string; basisBid?: string; month?: number;
  }>): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/bidsheet/bids/bulk`, bids)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Gets saved bid sheet preferences (crop, month, year) for the current user and a trade unit key. */
  getBidSheetPreference(tradeUnitKey: string): Observable<BidSheetPreferenceRead | null> {
    return this._dedupe(`bidsheet-preference-${tradeUnitKey}`,
      this.http.get<BidSheetPreferenceRead>(`${this.baseUrl}/bidsheet/preference`, { params: { tradeUnitKey } })
        .pipe(catchError(() => of(null)))
    );
  }

  /** Saves bid sheet preferences for the current user and a trade unit key. */
  /**
   * Saves a bid sheet preference.
   *
   * Named fields rather than positional ones. The server assigns cropCode/month/cropYear
   * unconditionally but only writes the JSON columns it is given, so every caller has to pass the
   * first three even when saving something unrelated -- as nine positional arguments that was a
   * mis-ordered call waiting to happen, and it grew every time a preference was added.
   */
  setBidSheetPreference(pref: BidSheetPreferenceUpdate): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/bidsheet/preference`, pref)
      .pipe(catchError(e => this.handleError(e)));
  }

  // =========================================================================
  // Sheets — the named, shareable working sets of locations
  //
  // Every write returns the whole sheet back, already ordered, so the caller never has to reload to
  // stay in step with a colleague who changed it a moment ago.
  // =========================================================================

  /** Sheets the signed-in user owns or has been shared on. */
  getBidSheets(): Observable<BidSheet[]> {
    return this.http.get<BidSheet[]>(`${this.baseUrl}/bidsheet/sheets`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** One sheet with its shares and locations. 403 if it exists but is not shared with you. */
  getBidSheet(sheetId: number): Observable<BidSheet> {
    return this.http.get<BidSheet>(`${this.baseUrl}/bidsheet/sheets/${sheetId}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Creates an empty sheet owned by the signed-in user. 409 if they already have one by that name. */
  createBidSheet(name: string): Observable<BidSheet> {
    return this.http.post<BidSheet>(`${this.baseUrl}/bidsheet/sheets`, { name })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Renames a sheet. Owner only. */
  renameBidSheet(sheetId: number, name: string): Observable<BidSheet> {
    return this.http.put<BidSheet>(`${this.baseUrl}/bidsheet/sheets/${sheetId}`, { name })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Deletes a sheet. Owner only. The locations on it are company-wide and survive. */
  deleteBidSheet(sheetId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/bidsheet/sheets/${sheetId}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /**
   * Replaces who a sheet is shared with. Any member. An empty list unshares it. Null (a 204) when the
   * caller took themselves off the sheet: the change is saved and there is no sheet left for them.
   */
  setBidSheetShares(sheetId: number, members: Array<{ memberType: string; memberId: string; name?: string }>): Observable<BidSheet | null> {
    return this.http.put<BidSheet | null>(`${this.baseUrl}/bidsheet/sheets/${sheetId}/shares`, { members })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Puts an existing location on the sheet. Idempotent. Any member. */
  addBidSheetLocation(sheetId: number, locationId: number): Observable<BidSheet> {
    return this.http.post<BidSheet>(`${this.baseUrl}/bidsheet/sheets/${sheetId}/locations`, { locationId })
      .pipe(catchError(e => this.handleError(e)));
  }

  /**
   * Saves the shared row order for a sheet. Any member; the order is shared, not per-user.
   *
   * Replaced the per-user, per-trade-unit JSON order the screen used before sheets.
   */
  setBidSheetRowOrder(sheetId: number, locationIds: number[]): Observable<BidSheet> {
    return this.http.put<BidSheet>(`${this.baseUrl}/bidsheet/sheets/${sheetId}/location-order`, { locationIds })
      .pipe(catchError(e => this.handleError(e)));
  }

  /**
   * Takes several locations off a sheet in one transaction — unlinking, not deleting. The locations
   * and their bids survive; other sheets holding them are untouched. One call rather than N so a
   * multi-select cannot half-apply. (Deleting an elevator outright is deleteBidSheetLocation, which
   * is restricted to its creator and warns how many sheets hold it.)
   */
  removeBidSheetLocations(sheetId: number, locationIds: number[]): Observable<BidSheet> {
    return this.http.put<BidSheet>(`${this.baseUrl}/bidsheet/sheets/${sheetId}/locations/remove`, { locationIds })
      .pipe(catchError(e => this.handleError(e)));
  }

  /**
   * Renames a location ON ONE SHEET. Locations are company-wide, so updateBidSheetLocation's rename
   * lands on every sheet holding that elevator; this stores the sheet's own display name and leaves
   * the canonical row alone. A null or blank name clears the override, back to the canonical name.
   */
  setBidSheetLocationName(sheetId: number, locationId: number, name: string | null): Observable<BidSheet> {
    return this.http.put<BidSheet>(`${this.baseUrl}/bidsheet/sheets/${sheetId}/locations/${locationId}/name`, { name })
      .pipe(catchError(e => this.handleError(e)));
  }

  /**
   * How many sheets hold this location. Deleting a location is company-wide now, so the confirmation
   * says the number out loud before it takes the elevator off everybody else's sheet.
   */
  getBidSheetLocationSheetCount(locationId: number): Observable<number> {
    return this.http.get<number>(`${this.baseUrl}/bidsheet/locations/${locationId}/sheet-count`)
      .pipe(catchError(e => this.handleError(e)));
  }

  // =========================================================================
  // BarChart Catalog (read-only vendor data behind the "Add from BarChart" picker)
  // =========================================================================

  /**
   * Searches the vendor catalog. Pass latitude+longitude (and optionally radiusMiles) for the
   * map-driven path; results then come back nearest-first with a distance on each one.
   *
   * Not de-duplicated on purpose: the caller varies these params as the user pans and types, so a
   * cached first response would be the wrong answer for every later call.
   */
  searchBarchartLocations(params: BarchartLocationSearchParams): Observable<BarchartCatalogLocation[]> {
    let httpParams = new HttpParams();
    if (params.search) httpParams = httpParams.set('search', params.search);
    if (params.state) httpParams = httpParams.set('state', params.state);
    if (params.commodityCode) httpParams = httpParams.set('commodityCode', params.commodityCode);
    if (params.cropYear != null) httpParams = httpParams.set('cropYear', String(params.cropYear));
    if (params.month != null) httpParams = httpParams.set('month', String(params.month));
    if (params.instrumentType) httpParams = httpParams.set('instrumentType', params.instrumentType);
    if (params.latitude != null && params.longitude != null) {
      httpParams = httpParams.set('latitude', String(params.latitude))
                             .set('longitude', String(params.longitude));
      if (params.radiusMiles != null) httpParams = httpParams.set('radiusMiles', String(params.radiusMiles));
    }
    if (params.take != null) httpParams = httpParams.set('take', String(params.take));
    return this.http.get<BarchartCatalogLocation[]>(`${this.baseUrl}/barchart/locations`, { params: httpParams })
      .pipe(catchError(e => this.handleError(e)));
  }

  /**
   * One catalog listing plus the bids it currently publishes -- what clicking an un-added pin on the
   * bid sheet map fetches, so the user sees real prices before deciding to add it.
   */
  getBarchartLocationDetail(locationKey: string): Observable<BarchartCatalogLocationDetail> {
    return this.http.get<BarchartCatalogLocationDetail>(`${this.baseUrl}/barchart/locations/${encodeURIComponent(locationKey)}`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Catalog totals and per-state counts. De-duplicated: it changes only when the feed reloads. */
  getBarchartCoverage(): Observable<BarchartCoverage> {
    return this._dedupe('barchart-coverage',
      this.http.get<BarchartCoverage>(`${this.baseUrl}/barchart/coverage`)
        .pipe(catchError(e => this.handleError(e)))
    );
  }
}
