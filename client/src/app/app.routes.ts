import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent)
  },
  {
    path: 'build-list',
    loadComponent: () => import('./pages/build-list/build-list.component').then(m => m.BuildListComponent)
  },
  {
    path: 'insights',
    loadComponent: () => import('./pages/insights/insights.component').then(m => m.InsightsComponent)
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  {
    path: 'position-report',
    loadComponent: () => import('./pages/position-report/position-report.component').then(m => m.PositionReportComponent)
  },
  {
    path: '**',
    redirectTo: ''
  }
];
