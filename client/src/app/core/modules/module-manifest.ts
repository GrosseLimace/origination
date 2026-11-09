import { Type } from '@angular/core';
import { Observable } from 'rxjs';
import { PermissionId } from '@core/access/permission-ids.generated';

/** A module of the SPA: a folder under src/app/features, matching the backend module of the same name. */
export type ModuleId =
  | 'customers'
  | 'contracts'
  | 'engagement'
  | 'producers'
  | 'lists'
  | 'bid-sheet'
  | 'usage-analytics'
  | 'calculators'
  | 'help'
  | 'whats-new';

/**
 * How a module describes itself to the app. Each module declares one in its <module>.module.ts, and app.modules.ts is
 * the only file that lists them all; core reads them through {@link ModuleRegistry} and never imports a module.
 */
export interface ModuleManifest {
  id: ModuleId;

  /** The module's pages. */
  routes?: readonly ModuleRoute[];

  /** The module's links in the header. */
  nav?: readonly NavItem[];

  /**
   * Loads what the module wants ready before its screens open, for a new trade-unit selection. Called in an
   * injection context on every non-empty selection; the next selection cancels it, so it returns the work as an
   * Observable rather than subscribing itself. It must load only what the user may read, and swallow its own
   * failures: one module's outage must not stop another's preload.
   */
  preload?: (tradeUnits: readonly string[]) => Observable<unknown>;
}

/**
 * A page of a module. Every page waits for sign-in. A page that names permissions also matches only for a user
 * holding all of them; anyone else is sent home, and never downloads the page.
 */
export interface ModuleRoute {
  /** The router path, without a leading slash: 'dashboard', 'usage-dashboard/users/:userId'. */
  path: string;
  /** Every permission the page needs, matching what its API calls check; empty for a page any signed-in user may open. */
  requires: readonly PermissionId[];
  loadComponent: () => Promise<Type<unknown>>;
}

/** A link in the header, shown only to users holding every permission in `requires`. */
export interface NavItem {
  /** The same permissions as the page it opens. */
  requires: readonly PermissionId[];
  /** The full name: the mobile menu, the user menu, and the desktop nav on wide screens. */
  label: string;
  /** The desktop nav below the widest breakpoint, where the full name doesn't fit. Defaults to `label`. */
  shortLabel?: string;
  /** Where it goes, with a leading slash: '/dashboard'. */
  path: string;
  /** The icon: path data for a stroked 24×24 SVG, one string per <path>. */
  icon: readonly string[];
  /** Position within its menu, lowest first. */
  order: number;
  /** 'main' is the header's nav, on the desktop bar and in the mobile menu; 'user' is the profile menu. */
  menu: 'main' | 'user';
}
