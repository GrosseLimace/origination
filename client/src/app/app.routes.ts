import { Routes } from '@angular/router';
import { moduleRoutes } from '@core/modules/module-routes';
import { appModules } from './app.modules';

/** Every module's pages, then the catch-all: a path that doesn't exist, or that the user may not open, goes home. */
export const routes: Routes = [
  ...moduleRoutes(appModules),
  {
    path: '**',
    redirectTo: ''
  }
];
