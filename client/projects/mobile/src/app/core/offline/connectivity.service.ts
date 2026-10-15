import { Injectable, signal } from '@angular/core';

/** `navigator.onLine` as a signal, kept current by the window online/offline events. */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private readonly _online = signal<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly online = this._online.asReadonly();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this._online.set(true));
      window.addEventListener('offline', () => this._online.set(false));
    }
  }
}
