import { isDevMode } from '@angular/core';

export interface BootstrapEvent {
  name: string;
  durationMs: number;
  props?: Record<string, string>;
  at: string;
}

/** Last few bootstrap events, readable from DevTools (`window.__mobBootstrap`) while no client-side telemetry SDK is wired. */
const recent: BootstrapEvent[] = [];

/**
 * Records one `MSAL.Bootstrap*` event. The desktop app carries no browser telemetry SDK either;
 * when Application Insights web is added (PLATFORM-REQUESTS.md E12, `cloud_RoleName =
 * origination-mobile-spa`) this is the single place to forward from.
 */
export function trackBootstrap(name: string, startedAt: number, props?: Record<string, string>): void {
  const event: BootstrapEvent = {
    name,
    durationMs: Math.round(performance.now() - startedAt),
    props,
    at: new Date().toISOString(),
  };
  recent.push(event);
  if (recent.length > 20) recent.shift();
  (globalThis as unknown as { __mobBootstrap?: BootstrapEvent[] }).__mobBootstrap = recent;

  if (isDevMode()) {
    console.info(`[${name}] ${event.durationMs}ms`, props ?? '');
  }
}

export function recentBootstrapEvents(): readonly BootstrapEvent[] {
  return recent;
}
