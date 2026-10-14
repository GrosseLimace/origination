import { DestroyRef, inject, Injectable } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { EMPTY, filter } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { environment } from '@env/environment';

/**
 * Fire-and-forget service for tracking explicit user interactions and screen navigation.
 * Listens to Angular router events to track which screen the user is on.
 * All calls are non-blocking — errors are silently swallowed.
 */
@Injectable({ providedIn: 'root' })
export class UsageTrackingService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly baseUrl = environment.apiBaseUrl;

  // Route path → feature code mapping. Codes must match the backend's FeatureNameMapper so
  // middleware-derived activity and these click events describe the same features.
  private readonly routeToFeature: Record<string, string> = {
    '/': 'customers',
    '/build-list': 'build-a-list',
    '/insights': 'insights',
    '/dashboard': 'dashboard',
    '/bid-sheet': 'bidsheet',
    '/daily-digest': 'daily-recap',
    '/usage-dashboard': 'usage-dashboard',
  };

  constructor() {
    // Track screen navigation via router events
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((e: NavigationEnd) => {
      const path = e.urlAfterRedirects.split('?')[0]; // strip query params
      const featureCode = this.routeToFeature[path];
      if (featureCode && featureCode !== 'usage-dashboard') {
        this.postClickEvent('screen_enter', featureCode);
      }
    });
  }

  /** Release notes opened from the header or the profile menu. Not a screen in routeToFeature:
   *  it is app chrome, and the backend maps GET /api/whats-new to the same system feature. */
  trackWhatsNewOpened(): void {
    this.postClickEvent('interaction', 'system', 'whats-new');
  }

  // Help panel and Help page. App chrome like What's New, so they report under 'system'. Events carry
  // FAQ ids, never what the user typed — except help-no-match, which has to carry the question for the
  // FAQ to learn from it; the API redacts that one as free text (TelemetrySanitizer).

  /** The panel was opened. `source` is where from: header, menu, drawer or page. */
  trackHelpOpened(source: string): void {
    this.postClickEvent('interaction', 'system', 'help-opened', source);
  }

  /** An answer was shown, whether typed, picked from a chip, or opened on the Help page. */
  trackHelpAnswer(faqId: string): void {
    this.postClickEvent('interaction', 'system', 'help-answer', faqId);
  }

  /** A typed question the content couldn't answer. Truncated here with headroom for the server's
   *  redaction markers, which lengthen the text; the stored column is 200 characters. */
  trackHelpNoMatch(question: string): void {
    this.postClickEvent('interaction', 'system', 'help-no-match', question.slice(0, 150));
  }

  /** How a troubleshooter run ended, as an outcome code only — never the name that was searched. */
  trackHelpTroubleshoot(outcome: string): void {
    this.postClickEvent('interaction', 'system', 'help-troubleshoot', outcome);
  }

  trackHelpFeedback(faqId: string, helpful: boolean): void {
    this.postClickEvent('interaction', 'system', helpful ? 'help-helpful' : 'help-not-helpful', faqId);
  }

  // Customer Page interactions
  trackProfileOpened(customerId: string): void {
    this.postClickEvent('interaction', 'customers', 'profile-opened', customerId);
  }

  trackCallClick(customerId: string): void {
    this.postClickEvent('call_click', 'customers', 'customer-details', customerId);
  }

  trackEmailClick(customerId: string): void {
    this.postClickEvent('email_click', 'customers', 'customer-details', customerId);
  }

  /** Address opened in Google Maps. Uses the generic 'interaction' event type on purpose: the
   *  usage dashboard tallies event types by explicit string match, so a brand-new type would be
   *  stored and then counted nowhere. */
  trackMapClick(customerId: string): void {
    this.postClickEvent('interaction', 'customers', 'map-click', customerId);
  }

  /** Bin site opened in Google Maps. Same 'interaction' event type as the address link, for the
   *  same reason; the subfeature keeps the two distinguishable. */
  trackBinSiteMapClick(customerId: string): void {
    this.postClickEvent('interaction', 'customers', 'bin-site-map-click', customerId);
  }

  trackTicketDropdownOpen(customerId?: string): void {
    this.postClickEvent('interaction', 'customers', 'tickets', customerId);
  }

  trackContractExpand(contractId?: string): void {
    this.postClickEvent('interaction', 'customers', 'contracts', contractId);
  }

  trackStorageDropdownOpen(customerId?: string): void {
    this.postClickEvent('interaction', 'customers', 'storage', customerId);
  }

  trackDpContractsDropdownOpen(customerId?: string): void {
    this.postClickEvent('interaction', 'customers', 'dp-contracts', customerId);
  }

  trackPlantingTabClick(): void {
    this.postClickEvent('interaction', 'customers', 'planting-intentions');
  }

  trackProducerDetailsEdit(customerId?: string): void {
    this.postClickEvent('interaction', 'customers', 'producer-details', customerId);
  }

  // Dashboard interactions
  trackDashboardTabClick(tabId: string): void {
    this.postClickEvent('interaction', 'dashboard', tabId);
  }

  postClickEvent(eventType: string, featureCode: string, subFeatureCode?: string, targetId?: string): void {
    this.http.post(`${this.baseUrl}/usage-dashboard/click-event`, {
      eventType,
      featureCode,
      subFeatureCode: subFeatureCode ?? null,
      targetId: targetId ?? null
    }).pipe(catchError(() => EMPTY)).subscribe();
  }
}
