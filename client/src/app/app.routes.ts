import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';

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
  {
    path: 'position-report',
    canActivate: [authGuard],
    loadComponent: () => import('./features/position-report/pages/position-report/position-report.component').then(m => m.PositionReportComponent)
  },
  {
    path: 'bid-sheet',
    canActivate: [authGuard],
    loadComponent: () => import('./features/bid-sheet/pages/bid-sheet/bid-sheet.component').then(m => m.BidSheetComponent)
  },
  {
    path: 'unshipped-bushels',
    canActivate: [authGuard],
    loadComponent: () => import('./features/unshipped-bushels/pages/unshipped-bushels/unshipped-bushels.component').then(m => m.UnshippedBushelsComponent)
  },
  {
    path: '**',
    redirectTo: ''
  }
];
