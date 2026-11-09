import { EnvironmentInjector, Injectable, InjectionToken, inject, isDevMode, runInInjectionContext } from '@angular/core';
import { EMPTY, Observable, defer } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ModuleManifest } from './module-manifest';

/** Every module of the app, provided by the composition root (app.modules.ts through main.ts). */
export const APP_MODULES = new InjectionToken<readonly ModuleManifest[]>('APP_MODULES');

/** What the modules contribute to the app, collected from their manifests. */
@Injectable({ providedIn: 'root' })
export class ModuleRegistry {
  private readonly injector = inject(EnvironmentInjector);
  /** Empty when nothing provides the list, as in a test that doesn't need modules. */
  readonly modules: readonly ModuleManifest[] = inject(APP_MODULES, { optional: true }) ?? [];

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
}
