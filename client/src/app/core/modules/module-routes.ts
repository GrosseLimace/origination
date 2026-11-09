import { Route } from '@angular/router';
import { permissionGuard, requires } from '@core/access/permission.guard';
import { authGuard } from '@core/auth/auth.guard';
import { ModuleManifest } from './module-manifest';

/**
 * The router's routes for every module's pages. Each page waits for sign-in. A page that names permissions is also
 * matched only for a user holding all of them, so anyone else falls through to the catch-all and never downloads it.
 */
export function moduleRoutes(modules: readonly ModuleManifest[]): Route[] {
  return modules.flatMap(module => module.routes ?? []).map(page => ({
    path: page.path,
    ...(page.requires.length > 0 ? { canMatch: [permissionGuard], data: requires(...page.requires) } : {}),
    canActivate: [authGuard],
    loadComponent: page.loadComponent,
  }));
}
