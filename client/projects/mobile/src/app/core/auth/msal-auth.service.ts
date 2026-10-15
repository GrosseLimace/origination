import { Injectable, inject, signal } from '@angular/core';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { EventType } from '@azure/msal-browser';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { OfflineStore } from '../offline/indexed-db';
import { MobileAccount, MobileAuthPort } from './auth.port';

@Injectable({ providedIn: 'root' })
export class MsalAuthService extends MobileAuthPort {
  private readonly msal = inject(MsalService);
  private readonly broadcast = inject(MsalBroadcastService);

  private readonly _account = signal<MobileAccount | null>(null);
  readonly account = this._account.asReadonly();

  constructor() {
    super();
    this.refreshAccount();
    // Keep the signal in step with MSAL: after redirect processing, silent renewals, and sign-out.
    this.broadcast.msalSubject$.subscribe((event) => {
      if (
        event.eventType === EventType.LOGIN_SUCCESS ||
        event.eventType === EventType.ACQUIRE_TOKEN_SUCCESS ||
        event.eventType === EventType.ACTIVE_ACCOUNT_CHANGED ||
        event.eventType === EventType.LOGOUT_SUCCESS
      ) {
        this.refreshAccount();
      }
    });
  }

  isSignedIn(): boolean {
    return this.msal.instance.getAllAccounts().length > 0;
  }

  async signIn(): Promise<void> {
    await firstValueFrom(this.msal.loginRedirect({ scopes: environment.apiScopes }));
  }

  async signOut(): Promise<void> {
    // Exception 4 compensation (ADR-001): clear everything the app cached on the device on sign-out.
    await OfflineStore.wipe();
    if ('caches' in globalThis) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    await firstValueFrom(this.msal.logoutRedirect({ postLogoutRedirectUri: environment.msal.postLogoutRedirectUri }));
  }

  refreshAccount(): void {
    const active = this.msal.instance.getActiveAccount() ?? this.msal.instance.getAllAccounts()[0] ?? null;
    if (active && !this.msal.instance.getActiveAccount()) {
      this.msal.instance.setActiveAccount(active);
    }
    this._account.set(
      active
        ? {
            name: active.name,
            username: active.username,
            oid: (active.idTokenClaims as { oid?: string } | undefined)?.oid ?? active.localAccountId,
          }
        : null,
    );
  }
}
