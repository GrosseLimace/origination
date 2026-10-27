import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
  UsageDashboardSummary,
  UsageDashboardUser,
  DailyActive,
  FeatureSessions,
  QueryLibraryUsage,
  QuerySearchGap,
  WeeklyTrend,
  ActivityBreakdown,
  UnderusedFeature,
  UserUsageDetail,
  ExcludedUser,
  AccessUsers,
  ExclusionPermissions,
  UsageManager,
  UsageJobTitle,
} from '@models';
import { environment } from '@env/environment';
import { injectApiErrorHandler } from '@core/http/api-error-handler';

/** The Usage Analytics module's API: the usage dashboard, a user's drill-down, and the excluded users. */
@Injectable({ providedIn: 'root' })
export class UsageDashboardApiService {
  private readonly http = inject(HttpClient);
  private readonly handleError = injectApiErrorHandler();
  private readonly baseUrl = environment.apiBaseUrl;

  // =========================================================================
  // Usage Dashboard
  // =========================================================================

  // The dashboard narrows by manager and by job title (the two intersect); it is organised by
  // reporting line and role, so the app-wide trade-unit selection is deliberately not sent.
  // Job titles go as a repeated query key (?jobTitles=A&jobTitles=B) rather than comma-joined,
  // because directory titles can contain commas.
  private usageParams(from: string, to: string, managerId?: string, jobTitles?: string[], extra?: Record<string, string>): Record<string, string | string[]> {
    const p: Record<string, string | string[]> = { from, to };
    if (managerId) p['managerId'] = managerId;
    if (jobTitles && jobTitles.length > 0) p['jobTitles'] = jobTitles;
    if (extra) Object.assign(p, extra);
    return p;
  }

  getUsageDashboardSummary(from: string, to: string, managerId?: string, jobTitles?: string[]): Observable<UsageDashboardSummary> {
    return this.http.get<UsageDashboardSummary>(`${this.baseUrl}/usage-dashboard/summary`, { params: this.usageParams(from, to, managerId, jobTitles) })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Returns the full user universe. Status filtering stays client-side: the same list also feeds
   *  the status donut, the activity-breakdown table and the low-usage panel, so a server-filtered
   *  response could not replace it. */
  getUsageDashboardUsers(from: string, to: string, managerId?: string, jobTitles?: string[]): Observable<UsageDashboardUser[]> {
    return this.http.get<UsageDashboardUser[]>(`${this.baseUrl}/usage-dashboard/users`, { params: this.usageParams(from, to, managerId, jobTitles) })
      .pipe(catchError(e => this.handleError(e)));
  }

  getUsageDailyActive(from: string, to: string, managerId?: string, jobTitles?: string[]): Observable<DailyActive[]> {
    return this.http.get<DailyActive[]>(`${this.baseUrl}/usage-dashboard/daily-active`, { params: this.usageParams(from, to, managerId, jobTitles) })
      .pipe(catchError(e => this.handleError(e)));
  }

  getUsageFeatureSessions(from: string, to: string, managerId?: string, jobTitles?: string[], screen?: string): Observable<FeatureSessions[]> {
    const extra: Record<string, string> = {};
    if (screen && screen !== 'all') extra['screen'] = screen;
    return this.http.get<FeatureSessions[]>(`${this.baseUrl}/usage-dashboard/feature-sessions`, { params: this.usageParams(from, to, managerId, jobTitles, extra) })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Trend over whole calendar weeks. Deliberately takes no date range — it is a trend view, so it
   *  does not re-fetch when the dashboard's window changes. */
  getUsageWeeklyTrend(managerId?: string, jobTitles?: string[], weeks = 8): Observable<WeeklyTrend[]> {
    const params: Record<string, string | string[]> = { weeks: weeks.toString() };
    if (managerId) params['managerId'] = managerId;
    if (jobTitles && jobTitles.length > 0) params['jobTitles'] = jobTitles;
    return this.http.get<WeeklyTrend[]>(`${this.baseUrl}/usage-dashboard/weekly-trend`, { params })
      .pipe(catchError(e => this.handleError(e)));
  }

  getUsageActivityBreakdown(from: string, to: string, managerId?: string, jobTitles?: string[]): Observable<ActivityBreakdown[]> {
    return this.http.get<ActivityBreakdown[]>(`${this.baseUrl}/usage-dashboard/activity-breakdown`, { params: this.usageParams(from, to, managerId, jobTitles) })
      .pipe(catchError(e => this.handleError(e)));
  }

  getUsageQueryLibraryUsage(from: string, to: string, managerId?: string, jobTitles?: string[]): Observable<QueryLibraryUsage[]> {
    return this.http.get<QueryLibraryUsage[]>(`${this.baseUrl}/usage-dashboard/query-library-usage`, { params: this.usageParams(from, to, managerId, jobTitles) })
      .pipe(catchError(e => this.handleError(e)));
  }

  getUsageQuerySearchGaps(from: string, to: string, managerId?: string, jobTitles?: string[]): Observable<QuerySearchGap[]> {
    return this.http.get<QuerySearchGap[]>(`${this.baseUrl}/usage-dashboard/query-search-gaps`, { params: this.usageParams(from, to, managerId, jobTitles) })
      .pipe(catchError(e => this.handleError(e)));
  }

  getUsageUnderusedFeatures(from: string, to: string, managerId?: string, jobTitles?: string[]): Observable<UnderusedFeature[]> {
    return this.http.get<UnderusedFeature[]>(`${this.baseUrl}/usage-dashboard/underused-features`, { params: this.usageParams(from, to, managerId, jobTitles) })
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Active managers for the dashboard's manager filter — every dashboard user gets the full roster,
   *  which the page needs up front to default the filter to the signed-in user. The server fails
   *  closed with a 503 when the TradeUnitPreferences DB is unreachable, so the picker shows an
   *  unavailable state. */
  getUsageManagers(): Observable<UsageManager[]> {
    return this.http.get<UsageManager[]>(`${this.baseUrl}/usage-dashboard/managers`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** Options for the job-title filter, with user counts inside the selected manager's team (or the
   *  whole organisation). Titles are recorded from sign-in tokens, so the list grows as people sign
   *  in after the claim was switched on; the "No title" option covers everyone else. */
  getUsageJobTitles(managerId?: string): Observable<UsageJobTitle[]> {
    const params: Record<string, string> = {};
    if (managerId) params['managerId'] = managerId;
    return this.http.get<UsageJobTitle[]>(`${this.baseUrl}/usage-dashboard/job-titles`, { params })
      .pipe(catchError(e => this.handleError(e)));
  }

  getUserUsageDetail(userId: string, from: string, to: string): Observable<UserUsageDetail> {
    return this.http.get<UserUsageDetail>(
      `${this.baseUrl}/usage-dashboard/users/${encodeURIComponent(userId)}/detail`,
      { params: this.usageParams(from, to) }
    ).pipe(catchError(e => this.handleError(e)));
  }

  // Accounts hidden from every usage-dashboard view. Excluding someone changes nothing about their
  // access to the app.

  /** Whether the signed-in user is on the exclusion-manager allowlist — gates the gear icon.
   *  The server enforces the same allowlist on every exclusion endpoint regardless. */
  getUsageExclusionsCanManage(): Observable<ExclusionPermissions> {
    return this.http.get<ExclusionPermissions>(`${this.baseUrl}/usage-dashboard/excluded-users/can-manage`)
      .pipe(catchError(e => this.handleError(e)));
  }

  getUsageExcludedUsers(): Observable<ExcludedUser[]> {
    return this.http.get<ExcludedUser[]>(`${this.baseUrl}/usage-dashboard/excluded-users`)
      .pipe(catchError(e => this.handleError(e)));
  }

  /** People with app access (Entra access-group members), for the exclusion picker. */
  getUsageAccessUsers(): Observable<AccessUsers> {
    return this.http.get<AccessUsers>(`${this.baseUrl}/usage-dashboard/access-users`)
      .pipe(catchError(e => this.handleError(e)));
  }

  addUsageExcludedUser(userId: string, reason?: string): Observable<ExcludedUser> {
    return this.http.post<ExcludedUser>(`${this.baseUrl}/usage-dashboard/excluded-users`, {
      userId,
      reason: reason?.trim() || null
    }).pipe(catchError(e => this.handleError(e)));
  }

  removeUsageExcludedUser(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/usage-dashboard/excluded-users/${id}`)
      .pipe(catchError(e => this.handleError(e)));
  }
}
