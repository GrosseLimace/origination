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

  // Route path → feature code mapping
  private readonly routeToFeature: Record<string, string> = {
    '/': 'customers',
    '/build-list': 'build-a-list',
    '/insights': 'insights',
    '/dashboard': 'dashboard',
    '/bid-sheet': 'bidsheet',
    '/position-report': 'position-report',
    '/unshipped-bushels': 'insights',
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

  // Customer Page interactions
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

  trackPlantingTabClick(): void {
    this.postClickEvent('interaction', 'customers', 'planting-intentions');
  }

  trackProducerDetailsEdit(customerId?: string): void {
    this.postClickEvent('interaction', 'customers', 'producer-details', customerId);
  }

  trackNoteCreated(customerId?: string): void {
    this.postClickEvent('interaction', 'customers', 'notes-create', customerId);
  }

  // Dashboard interactions
  trackDashboardTabClick(tabId: string): void {
    this.postClickEvent('interaction', 'dashboard', tabId);
  }

  trackSeasonTargetsSaved(): void {
    this.postClickEvent('interaction', 'dashboard', 'set-season-targets');
  }

  trackFeatureNav(featureCode: string, subFeatureCode?: string): void {
    this.postClickEvent('feature_nav', featureCode, subFeatureCode);
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
