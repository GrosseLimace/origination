import { EnvironmentInjector, Injectable, InjectionToken, computed, inject, isDevMode, runInInjectionContext } from '@angular/core';
import { EMPTY, Observable, defer } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { PermissionService } from '@core/access/permission.service';
import { CustomerContribution, CustomerPanel, CustomerSlot, ModuleManifest, NavItem } from './module-manifest';

/** Every module of the app, provided by the composition root (app.modules.ts through main.ts). */
export const APP_MODULES = new InjectionToken<readonly ModuleManifest[]>('APP_MODULES');

/** What the modules contribute to the app, collected from their manifests. */
@Injectable({ providedIn: 'root' })
export class ModuleRegistry {
  private readonly injector = inject(EnvironmentInjector);
  private readonly access = inject(PermissionService);
  /** Empty when nothing provides the list, as in a test that doesn't need modules. */
  readonly modules: readonly ModuleManifest[] = inject(APP_MODULES, { optional: true }) ?? [];

  /** The header's nav links the user may follow, in order. */
  readonly mainNav = computed(() => this.navItems('main'));
  /** The profile menu's links the user may follow, in order. */
  readonly userNav = computed(() => this.navItems('user'));

  // The customer screen's contributions the user holds the permissions for, in order. Each host still keeps only
  // those that apply to the selected customer (SelectedCustomerContext.appliesTo), which changes as the user moves
  // between customers.

  /** The customer profile's tabs. */
  readonly customerTabs = computed(() => this.permitted(module => module.customerTabs));
  private readonly panels = computed(() => this.permitted(module => module.customerPanels));

  /** The panels in one slot of the customer screen. */
  customerPanels(slot: CustomerSlot): CustomerPanel[] {
    return this.panels().filter(panel => panel.slot === slot);
  }

  /**
   * Each module's preload for this trade-unit selection, run in an injection context when subscribed. A preload that
   * throws or errors anyway ends quietly: it is merged into the app's trade-unit load, which one module's bug must
   * not stop for the rest of the session.
   */
  preloads(tradeUnits: readonly string[]): Observable<unknown>[] {
    return this.modules
      .filter(module => module.preload)
      .map(module => defer(() => runInInjectionContext(this.injector, () => module.preload!(tradeUnits))).pipe(
        catchError(error => {
          if (isDevMode()) console.error(`The ${module.id} module's preload failed:`, error);
          return EMPTY;
        }),
      ));
  }

  private navItems(menu: NavItem['menu']): NavItem[] {
    return this.modules
      .flatMap(module => module.nav ?? [])
      .filter(item => item.menu === menu && this.access.hasAll(item.requires))
      .sort((a, b) => a.order - b.order);
  }

  private permitted<T extends CustomerContribution>(pick: (module: ModuleManifest) => readonly T[] | undefined): T[] {
    return this.modules
      .flatMap(module => pick(module) ?? [])
      .filter(contribution => this.access.hasAll(contribution.requires))
      .sort((a, b) => a.order - b.order);
  }
}
