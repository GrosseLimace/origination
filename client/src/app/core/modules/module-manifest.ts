import { Observable } from 'rxjs';

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
   * Loads what the module wants ready before its screens open, for a new trade-unit selection. Called in an
   * injection context on every non-empty selection; the next selection cancels it, so it returns the work as an
   * Observable rather than subscribing itself. It must load only what the user may read, and swallow its own
   * failures: one module's outage must not stop another's preload.
   */
  preload?: (tradeUnits: readonly string[]) => Observable<unknown>;
}
