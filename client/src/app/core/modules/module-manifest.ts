import { Signal, Type } from '@angular/core';
import { Observable } from 'rxjs';
import { PermissionId } from '@core/access/permission-ids.generated';
import { CustomerSegment } from '@models';

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

  /**
   * Set on a module the API has no counterpart for: Calculators, Help and What's New. It owns no permissions, so
   * `/api/me/permissions` never lists it among the user's modules, and every user holds it.
   */
  spaOnly?: true;

  /** The module's pages. */
  routes?: readonly ModuleRoute[];

  /** The module's links in the header. */
  nav?: readonly NavItem[];

  /** The module's tabs on the customer profile. */
  customerTabs?: readonly CustomerTab[];

  /** The module's panels on the customer screen, each in one slot. */
  customerPanels?: readonly CustomerPanel[];

  /**
   * Loads what the module wants ready before its screens open, for a new trade-unit selection. Called in an
   * injection context on every non-empty selection, once the user's permissions have loaded, and only for a user
   * holding the module (one of its permissions); the next selection cancels it, so it returns the work as an
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

/**
 * Something a module adds to the customer screen. It shows only to a user holding every permission in `requires`, and
 * only for a customer whose segment is in `segments`. It reads the customer from SelectedCustomerContext and its data
 * from its own module, so the host that renders it passes it nothing.
 */
export interface CustomerContribution {
  /** Names it within its module: 'planting', 'organic'. */
  id: string;
  /** Every permission it needs: each read it makes. Empty for something every signed-in user may see. */
  requires: readonly PermissionId[];
  /** The customers it applies to. Omitted or empty: every customer. */
  segments?: readonly CustomerSegment[];
  /** Position among the other contributions to the same place, lowest first. A host's own items use fixed values. */
  order: number;
  /** Loads its component, the first time it is shown; a user who never sees it never downloads it. */
  component: () => Promise<Type<unknown>>;
}

/**
 * The places on the customer screen a panel can go. On the profile: `badges` beside the name, and `badge-panels` under
 * it for what a badge opens; `actions` in the row under the name, beside the linked-producer picker; `toolbar`, the
 * header's buttons at its top right; `details` in the details row, and inside its Contact column `contacts` above the
 * customer's address and `locations` below its phone and email; `summary` between the header and the tabs. On the home
 * page: `sidebar`, the right column, and `floating`, the launcher over the page. In the customer list: `list-filter`,
 * above its rows, where a panel narrows the list through the list's CustomerListFilter.
 */
export type CustomerSlot =
  | 'badges' | 'badge-panels' | 'actions' | 'toolbar' | 'details' | 'contacts' | 'locations' | 'summary' | 'sidebar'
  | 'floating' | 'list-filter';

/** A panel on the customer screen. */
export interface CustomerPanel extends CustomerContribution {
  slot: CustomerSlot;
}

/** A tab on the customer profile. */
export interface CustomerTab extends CustomerContribution {
  label: string;
  /** The label on narrow layouts: 'Cont', 'Plan'. */
  shortLabel: string;
  /** The count beside the label, or null for none. Called once, in an injection context, when the tab first shows. */
  badge?: () => Signal<number | null>;
}
