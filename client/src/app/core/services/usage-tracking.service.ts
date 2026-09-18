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
    '/unshipped-bushels': 'unshipped-bushels',
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
