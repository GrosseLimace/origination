import { MsalService } from '@azure/msal-angular';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { trackBootstrap } from '../telemetry/bootstrap-telemetry';

/**
 * MSAL bootstrap, run as an app initializer so it completes before the router activates a route.
 * Mirrors the four-case pattern Burdi documents (app.config.ts:99-156) and emits one
 * `MSAL.Bootstrap*` telemetry event per cold start so the distribution can be read in App Insights:
 *
 *  A  redirect response processed        — we just came back from login.microsoftonline.com
 *  B  cached account in sessionStorage    — same tab, warm start
 *  C1 no account, ssoSilent succeeded     — new tab / relaunched PWA; the Entra session cookie carried us
 *  C2 no account, ssoSilent failed        — guard will loginRedirect (or route to /offline when offline)
 *
 * Because a PWA has no public routes and iOS discards backgrounded apps, most real-world cold
 * starts land in C1. That is expected; it is the cost of SessionStorage.
 */
export async function bootstrapMsal(msal: MsalService): Promise<void> {
  const started = performance.now();
  await msal.instance.initialize();

  let redirectResult: unknown = null;
  try {
    redirectResult = await firstValueFrom(msal.handleRedirectObservable());
  } catch (error) {
    // Interaction errors surface through MsalBroadcastService; never block bootstrap on them.
    trackBootstrap('MSAL.BootstrapRedirectError', started, { error: describe(error) });
  }

  if (redirectResult) {
    trackBootstrap('MSAL.BootstrapRedirect', started);
    return;
  }

  if (msal.instance.getAllAccounts().length > 0) {
    trackBootstrap('MSAL.BootstrapCachedAccount', started);
    return;
  }

  if (!navigator.onLine) {
    // No account and no network: nothing to try. The guard sends the user to /offline.
    trackBootstrap('MSAL.BootstrapOfflineNoAccount', started);
    return;
  }

  try {
    await firstValueFrom(msal.ssoSilent({ scopes: environment.apiScopes }));
    trackBootstrap('MSAL.BootstrapSsoSilent', started);
  } catch (error) {
    trackBootstrap('MSAL.BootstrapSsoSilentFailed', started, { error: describe(error) });
    // Case C2: MsalGuard performs the interactive redirect on the first guarded route.
  }
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'errorCode' in error) {
    return String((error as { errorCode: unknown }).errorCode);
  }
  return error instanceof Error ? error.name : 'unknown';
}
