import { Injectable, inject, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { finalize, map, share, switchMap, take, tap } from 'rxjs/operators';
import { PermissionService } from '@core/access/permission.service';
import { SessionReset } from '@core/auth/session-reset.service';
import { ProducerProfiles } from '@core/context/producer-profiles';
import { ApiService } from '@core/services/api.service';
import { ProducerDetails } from '@models';

/**
 * Every producer's saved details, by customer id: the one copy the app keeps. Producers' preload reads them on every
 * trade-unit change, and the home page again on each visit; a read already running is shared. Only a user holding
 * producer-details:read reads them, so nobody else is refused on every trade-unit change. Cleared when the session
 * ends. The rest of the app reads it as ProducerProfiles.
 */
@Injectable({ providedIn: 'root' })
export class ProducerProfileStore implements ProducerProfiles {
  private readonly api = inject(ApiService);
  private readonly permissions = inject(PermissionService);

  private readonly _profiles = signal<ReadonlyMap<number, ProducerDetails>>(new Map());
  private readonly _loaded = signal(false);
  readonly profiles = this._profiles.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  /** The read now running, shared by everyone who asks while it runs. */
  private running: Observable<ProducerDetails[]> | null = null;
  /** Bumped when the session ends, so a read started before then can't put the last user's details back. */
  private session = 0;

  constructor() {
    inject(SessionReset).onReset(() => {
      this.session++;
      this.running = null;
      this._profiles.set(new Map());
      this._loaded.set(false);
    });
  }

  profileOf(customerId: number): ProducerDetails | undefined {
    return this._profiles().get(customerId);
  }

  load(): Observable<ProducerDetails[]> {
    if (this.running) return this.running;
    const session = this.session;
    const read = this.permissions.loaded().pipe(
      take(1),
      switchMap(() => this.permissions.has('producer-details:read') ? this.api.getAllProducerDetails() : of([])),
      map(details => details ?? []),
      tap(details => {
        if (session !== this.session) return;
        // The full set, so it replaces what was there: details deleted since the last read go too.
        this._profiles.set(new Map(details.map(d => [d.customerId, d])));
        this._loaded.set(true);
      }),
      finalize(() => { if (this.running === read) this.running = null; }),
      share(),
    );
    this.running = read;
    return read;
  }

  put(details: ProducerDetails): void {
    this._profiles.update(profiles => new Map(profiles).set(details.customerId, details));
  }
}
