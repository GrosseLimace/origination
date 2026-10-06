import { Routes } from '@angular/router';

import { authGuard } from './guards/auth.guard';
import { usageDashboardGuard } from './guards/usage-dashboard.guard';
import { environment } from '../environments/environment';

export const routes: Routes = [
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/customers/pages/home/home.component').then(m => m.HomeComponent)
  },
  {
    path: 'build-list',
    canActivate: [authGuard],
    loadComponent: () => import('./features/build-list/pages/build-list/build-list.component').then(m => m.BuildListComponent)
  },
  {
    path: 'insights',
    canActivate: [authGuard],
    loadComponent: () => import('./features/customers/pages/insights/insights.component').then(m => m.InsightsComponent)
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./features/dashboard/pages/dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  environment.bidSheetEnabled
    ? {
        path: 'bid-sheet',
        canActivate: [authGuard],
        loadComponent: () => import('./features/bid-sheet/pages/bid-sheet/bid-sheet.component').then(m => m.BidSheetComponent)
      }
    : { path: 'bid-sheet', redirectTo: '' },
  {
    path: 'unshipped-bushels',
    canActivate: [authGuard],
    loadComponent: () => import('./features/unshipped-bushels/pages/unshipped-bushels/unshipped-bushels.component').then(m => m.UnshippedBushelsComponent)
  },
  // Daily Digest is gated by environment.dailyDigestEnabled (OFF in prod until launch).
  // When disabled, /daily-digest redirects home so the page can't be reached by URL.
  environment.dailyDigestEnabled
    ? {
        path: 'daily-digest',
        canActivate: [authGuard],
        loadComponent: () => import('./features/daily-digest/pages/daily-digest/daily-digest.component').then(m => m.DailyDigestComponent)
      }
    : { path: 'daily-digest', redirectTo: '' },
  environment.usageDashboardEnabled
    ? {
        path: 'usage-dashboard',
        canActivate: [authGuard, usageDashboardGuard],
        loadComponent: () => import('./features/usage-dashboard/pages/usage-dashboard/usage-dashboard.component').then(m => m.UsageDashboardComponent)
      }
    : { path: 'usage-dashboard', redirectTo: '' },
  environment.usageDashboardEnabled
    ? {
        path: 'usage-dashboard/users/:userId',
        canActivate: [authGuard, usageDashboardGuard],
        loadComponent: () => import('./features/usage-dashboard/pages/user-usage-detail/user-usage-detail.component').then(m => m.UserUsageDetailComponent)
      }
    : { path: 'usage-dashboard/users/:userId', redirectTo: '' },
  // Release notes. Not flag-gated: the notes file itself is the switch — a deploy that adds no
  // entry announces nothing, and the page simply says nothing has been published yet.
  {
    path: 'whats-new',
    canActivate: [authGuard],
    loadComponent: () => import('./features/whats-new/pages/whats-new/whats-new.component').then(m => m.WhatsNewComponent)
  },
  // SPIKE: the Contract Workspace on sample data. Local only; never enable in a deployed env.
  environment.cwsSpikeEnabled
    ? {
        path: 'cws',
        canActivate: [authGuard],
        loadChildren: () => import('./features/cws-spike/cws-spike.routes').then(m => m.CWS_SPIKE_ROUTES)
      }
    : { path: 'cws', redirectTo: '' },
  {
    path: '**',
    redirectTo: ''
  }
];
