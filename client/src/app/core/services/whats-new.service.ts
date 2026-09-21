// Angular core
import { Injectable, computed, inject, signal } from '@angular/core';

// Angular HTTP
import { HttpClient } from '@angular/common/http';

// RxJS
import { catchError, firstValueFrom, forkJoin, of } from 'rxjs';

// Models
import { AppVersionInfo, WhatsNewRelease } from '@models';

// Environment
import { environment } from '../../../environments/environment';

/** Namespaced so it sits alongside the app's other localStorage keys. */
const LAST_SEEN_KEY = 'origination.whatsNew.lastSeenVersion';

/**
 * Tracks which release notes the user has already seen, so the app can announce a deploy once
 * and then stay quiet.
 *
 * The notes ship with the deploy, so nothing needs to stamp a release version at build time:
 * the first release the API returns is the current one. "Has this user seen this deploy?" is a
 * string equality check against the version recorded in localStorage, which means there is no
 * version parsing or ordering to get wrong. A deploy that does not touch the notes file never
 * changes the version, so a release with nothing worth saying stays silent on its own.
 *
 * The stored key is written only when the user ACKNOWLEDGES a release — dismissing the dialog or
 * opening the What's New page — never on load. Otherwise someone who closed the tab before
 * reading would never see the notes at all.
 */
@Injectable({ providedIn: 'root' })
export class WhatsNewService {
  private readonly http = inject(HttpClient);

  private readonly _releases = signal<WhatsNewRelease[]>([]);
  private readonly _version = signal<AppVersionInfo | null>(null);
  private readonly _lastSeenVersion = signal<string | null>(readLastSeenVersion());
  private readonly _loaded = signal(false);

  readonly releases = this._releases.asReadonly();
  readonly version = this._version.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  /** The release the running build is announcing, or null before the notes have loaded. */
  readonly currentVersion = computed(() => this._releases()[0]?.version ?? null);

  /**
   * The releases published since the user last acknowledged one, newest first. Position in the
   * list is the source of truth, so a user two releases behind sees both entries and a rollback
   * re-announces once.
   *
   * A user with nothing recorded yet — a new browser, cleared storage, or the deploy that
   * introduced this feature — is shown the current release only.
   */
  readonly unseenReleases = computed<WhatsNewRelease[]>(() => {
    const all = this._releases();
    if (all.length === 0) return [];

    const lastSeen = this._lastSeenVersion();
    if (lastSeen === null) return [all[0]];
    if (lastSeen === all[0].version) return [];

    const lastSeenIndex = all.findIndex(release => release.version === lastSeen);
    // An unrecognised stored version (a renamed or pruned entry) falls back to announcing only
    // the current release rather than dumping the entire history at the user.
    return lastSeenIndex === -1 ? [all[0]] : all.slice(0, lastSeenIndex);
  });

  readonly hasUnseen = computed(() => this.unseenReleases().length > 0);

  /**
   * Fetches the notes and the build stamp. The version call is optional — a failure there must
   * not cost the user their release notes — so it degrades to null.
   */
  async load(): Promise<void> {
    const [releases, version] = await firstValueFrom(
      forkJoin([
        this.http.get<WhatsNewRelease[]>(`${environment.apiBaseUrl}/whats-new`),
        this.http.get<AppVersionInfo>(`${environment.apiBaseUrl}/version`).pipe(
          catchError(() => of<AppVersionInfo | null>(null))
        )
      ])
    );

    this._releases.set(releases ?? []);
    this._version.set(version);
    this._loaded.set(true);
  }

  /** Records the current release as seen. Call only on an explicit acknowledgment. */
  markCurrentAsSeen(): void {
    const current = this.currentVersion();
    if (current === null) return;

    this._lastSeenVersion.set(current);
    try {
      window.localStorage.setItem(LAST_SEEN_KEY, current);
    } catch {
      // Private browsing can throw on write. The signal still suppresses the dialog for this
      // session; it just will not survive a reload.
    }
  }
}

function readLastSeenVersion(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}
