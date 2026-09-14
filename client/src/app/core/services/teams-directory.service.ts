import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MsalService } from '@azure/msal-angular';
import { Observable, forkJoin, from, of } from 'rxjs';
import { catchError, map, shareReplay, switchMap } from 'rxjs/operators';

/** A Teams channel the signed-in user can post to, as read from Microsoft Graph. */
export interface GraphTeamsChannel {
  teamId: string;
  teamName: string;
  channelId: string;
  displayName: string;
  /** The channel's "send to channel" address. Channels without one are dropped — see the service doc. */
  channelEmail: string;
}

interface GraphList<T> { value?: T[] }
interface GraphTeam { id?: string; displayName?: string }
interface GraphChannel { id?: string; displayName?: string; email?: string; membershipType?: string }

/**
 * Reads the Teams channels the SIGNED-IN USER belongs to, using their own delegated token rather
 * than the app's identity.
 *
 * Why delegated: it scopes the result for free. The user only ever sees channels they are actually
 * in, which is both the authorization boundary we want and the answer to "there are too many
 * channels" — a person's own teams are a far smaller set than the company's. The app-only
 * alternative would read every channel in the tenant and then need its own filtering.
 *
 * Channels WITHOUT an email address are dropped. Teams does not create one until somebody opens the
 * channel and picks "Get email address", and we deliberately do not provision addresses ourselves
 * (that needs a broader, write-scoped permission). The cost is that such a channel simply will not
 * appear in the picker until someone generates its address once.
 *
 * Everything degrades to an empty list. Until admin consent for Channel.ReadBasic.All is granted the
 * token request fails, and the picker must carry on offering people and trade units as though this
 * feature were not there.
 */
@Injectable({ providedIn: 'root' })
export class TeamsDirectoryService {
  private readonly msal = inject(MsalService);
  private readonly http = inject(HttpClient);

  private static readonly SCOPES = ['Channel.ReadBasic.All'];
  private static readonly GRAPH = 'https://graph.microsoft.com/v1.0';

  /** Cached for the session: this is several requests (one per team) and the answer rarely changes. */
  private channels$?: Observable<GraphTeamsChannel[]>;

  getChannels(): Observable<GraphTeamsChannel[]> {
    this.channels$ ??= this.loadChannels().pipe(shareReplay({ bufferSize: 1, refCount: false }));
    return this.channels$;
  }

  private loadChannels(): Observable<GraphTeamsChannel[]> {
    const account = this.msal.instance.getActiveAccount() ?? this.msal.instance.getAllAccounts()[0];
    if (!account) return of([]);

    // Silent only, never a popup. This runs while the notes pane loads, and an unprompted sign-in
    // dialog over a page the user did not ask to authenticate is worse than an absent feature.
    return from(this.msal.instance.acquireTokenSilent({ scopes: TeamsDirectoryService.SCOPES, account })).pipe(
      switchMap(result => {
        const headers = { Authorization: `Bearer ${result.accessToken}` };
        return this.http.get<GraphList<GraphTeam>>(`${TeamsDirectoryService.GRAPH}/me/joinedTeams`, { headers }).pipe(
          switchMap(teams => {
            const joined = (teams.value ?? []).filter(t => t.id);
            if (joined.length === 0) return of<GraphTeamsChannel[]>([]);
            // One request per team, in parallel. $select keeps the payload small and, importantly,
            // asks for `email` explicitly — Graph omits it otherwise because populating it is slow.
            return forkJoin(joined.map(team =>
              this.http.get<GraphList<GraphChannel>>(
                `${TeamsDirectoryService.GRAPH}/teams/${team.id}/channels?$select=id,displayName,email,membershipType`,
                { headers },
              ).pipe(
                map(res => (res.value ?? [])
                  .filter(c => !!c.id && !!c.email)
                  .map<GraphTeamsChannel>(c => ({
                    teamId: team.id!,
                    teamName: team.displayName ?? '',
                    channelId: c.id!,
                    displayName: c.displayName ?? '',
                    channelEmail: c.email!,
                  }))),
                // One inaccessible team must not lose the other twenty.
                catchError(() => of<GraphTeamsChannel[]>([])),
              ),
            )).pipe(map(perTeam => perTeam.flat()));
          }),
        );
      }),
      catchError(() => of<GraphTeamsChannel[]>([])),
    );
  }
}
