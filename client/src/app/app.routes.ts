import { Routes } from '@angular/router';
import { MsalGuard } from '@azure/msal-angular';

export const routes: Routes = [
  {
    path: '',
    canActivate: [MsalGuard],
    loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent)
  },
  {
    path: 'build-list',
    canActivate: [MsalGuard],
    loadComponent: () => import('./pages/build-list/build-list.component').then(m => m.BuildListComponent)
  },
  {
    path: 'insights',
    canActivate: [MsalGuard],
    loadComponent: () => import('./pages/insights/insights.component').then(m => m.InsightsComponent)
  },
  {
    path: 'dashboard',
    canActivate: [MsalGuard],
    loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  {
    path: 'position-report',
    canActivate: [MsalGuard],
    loadComponent: () => import('./pages/position-report/position-report.component').then(m => m.PositionReportComponent)
  },
  {
    path: 'bid-sheet',
    canActivate: [MsalGuard],
    loadComponent: () => import('./pages/bid-sheet/bid-sheet.component').then(m => m.BidSheetComponent)
  },
  {
    path: '**',
    redirectTo: ''
  }
];
