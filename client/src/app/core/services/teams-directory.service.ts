import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, shareReplay } from 'rxjs/operators';

import { ApiService } from '@core/services/api.service';

/** A Teams channel the signed-in user can post to. */
export interface GraphTeamsChannel {
  teamId: string;
  teamName: string;
  channelId: string;
  displayName: string;
  /** The channel's "send to channel" address. Needed only to register the channel the first time it
   *  is picked; it is never stored on a note. */
  channelEmail: string;
}

/**
 * The Teams channels the signed-in user belongs to.
 *
 * This asks our own API, which calls Microsoft Graph on-behalf-of the user. It used to call Graph
 * straight from the browser with the SPA's token. IT Security moved it server-side on 2026-09-15,
 * because delegated Graph permissions live on the API registration across the fleet, and anything
 * added by hand to a SPA registration is wiped when their config reconciler next runs.
 *
 * The scoping is unchanged: the user's identity flows through the exchange, so Graph still returns
 * only the teams that person is in. What did change is that the per-team fan-out now happens
 * server-side, so this is one request rather than one per team.
 *
 * Failure degrades to an empty list. Until admin consent is granted in an environment the API
 * returns nothing, and the picker must carry on offering people and trade units as before.
 */
@Injectable({ providedIn: 'root' })
export class TeamsDirectoryService {
  private readonly api = inject(ApiService);

  /** Cached for the session; the API caches per user as well. */
  private channels$?: Observable<GraphTeamsChannel[]>;

  getChannels(): Observable<GraphTeamsChannel[]> {
    this.channels$ ??= this.api.getMyTeamsChannels().pipe(
      catchError(() => of<GraphTeamsChannel[]>([])),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.channels$;
  }
}
