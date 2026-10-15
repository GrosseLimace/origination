import { Signal } from '@angular/core';

/** The slice of the signed-in account the UI needs. */
export interface MobileAccount {
  name?: string;
  username?: string;
  /** Entra object id — the per-user key the API also uses for rate limiting and idempotency. */
  oid?: string;
}

/**
 * Authentication seam. Features depend on this, never on MSAL directly, so the browser
 * implementation (MsalAuthService, redirect flow + sessionStorage) can be swapped for a native
 * one (Capacitor + MSAL broker, Keychain/Keystore, certificate pinning) without touching features —
 * the escalation path ADR-001 keeps open if IT Security declines exception 3 or 4.
 */
export abstract class MobileAuthPort {
  abstract readonly account: Signal<MobileAccount | null>;
  abstract isSignedIn(): boolean;
  abstract signIn(): Promise<void>;
  abstract signOut(): Promise<void>;
}
