import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WhatsNewService } from './whats-new.service';
import { environment } from '@env/environment';
import type { AppVersionInfo, WhatsNewRelease } from '@models';

const BASE = environment.apiBaseUrl;
const LAST_SEEN_KEY = 'origination.whatsNew.lastSeenVersion';

function release(version: string, title = `Release ${version}`): WhatsNewRelease {
  return {
    version,
    releasedOn: '2026-09-15',
    title,
    items: [{ kind: 'added', text: 'Something new.' }]
  };
}

const versionInfo: AppVersionInfo = {
  releaseVersion: '2026.09.3',
  releasedOn: '2026-09-15',
  commitSha: 'local',
  shortSha: 'local',
  buildNumber: 'local',
  environment: 'Development'
};

describe('WhatsNewService', () => {
  let httpMock: HttpTestingController;

  /** Builds the service AFTER localStorage is arranged — the stored version is read in a field
   *  initializer, so it has to be in place before the service is constructed. */
  function createService(): WhatsNewService {
    TestBed.configureTestingModule({
      providers: [WhatsNewService, provideHttpClient(), provideHttpClientTesting()]
    });
    const service = TestBed.inject(WhatsNewService);
    httpMock = TestBed.inject(HttpTestingController);
    return service;
  }

  /** Answers both calls load() makes. */
  function flushLoad(releases: WhatsNewRelease[], version: AppVersionInfo | null = versionInfo): void {
    httpMock.expectOne(`${BASE}/whats-new`).flush(releases);
    const versionReq = httpMock.expectOne(`${BASE}/version`);
    if (version === null) {
      versionReq.flush('boom', { status: 500, statusText: 'Server Error' });
    } else {
      versionReq.flush(version);
    }
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  // ── Loading ────────────────────────────────────────────────────────────────

  it('load() fetches the notes and the build stamp', async () => {
    const service = createService();

    const loading = service.load();
    flushLoad([release('2026.09.3')]);
    await loading;

    expect(service.releases()).toHaveLength(1);
    expect(service.version()?.shortSha).toBe('local');
    expect(service.loaded()).toBe(true);
    expect(service.currentVersion()).toBe('2026.09.3');
  });

  it('load() still delivers the notes when the version call fails', async () => {
    // A failed build stamp must never cost the user their release notes.
    const service = createService();

    const loading = service.load();
    flushLoad([release('2026.09.3')], null);
    await loading;

    expect(service.releases()).toHaveLength(1);
    expect(service.version()).toBeNull();
  });

  // ── unseenReleases: every branch ───────────────────────────────────────────

  it('reports nothing unseen before anything has loaded', () => {
    const service = createService();

    expect(service.unseenReleases()).toEqual([]);
    expect(service.hasUnseen()).toBe(false);
    expect(service.currentVersion()).toBeNull();
  });

  it('shows only the current release when nothing has been recorded yet', async () => {
    const service = createService();

    const loading = service.load();
    flushLoad([release('2026.09.3'), release('2026.09.2'), release('2026.09.1')]);
    await loading;

    expect(service.unseenReleases().map(r => r.version)).toEqual(['2026.09.3']);
    expect(service.hasUnseen()).toBe(true);
  });

  it('shows nothing when the stored version is already the current one', async () => {
    localStorage.setItem(LAST_SEEN_KEY, '2026.09.3');
    const service = createService();

    const loading = service.load();
    flushLoad([release('2026.09.3'), release('2026.09.2')]);
    await loading;

    expect(service.unseenReleases()).toEqual([]);
    expect(service.hasUnseen()).toBe(false);
  });

  it('shows every release published since the stored one, newest first', async () => {
    localStorage.setItem(LAST_SEEN_KEY, '2026.09.1');
    const service = createService();

    const loading = service.load();
    flushLoad([release('2026.09.3'), release('2026.09.2'), release('2026.09.1')]);
    await loading;

    expect(service.unseenReleases().map(r => r.version)).toEqual(['2026.09.3', '2026.09.2']);
  });

  it('falls back to the current release when the stored version is unrecognised', async () => {
    // A renamed or pruned entry must not dump the whole history at the user.
    localStorage.setItem(LAST_SEEN_KEY, '2019.01.1');
    const service = createService();

    const loading = service.load();
    flushLoad([release('2026.09.3'), release('2026.09.2')]);
    await loading;

    expect(service.unseenReleases().map(r => r.version)).toEqual(['2026.09.3']);
  });

  // ── Acknowledgment ─────────────────────────────────────────────────────────

  it('markCurrentAsSeen() persists the current version and clears the unread state', async () => {
    const service = createService();

    const loading = service.load();
    flushLoad([release('2026.09.3'), release('2026.09.2')]);
    await loading;

    service.markCurrentAsSeen();

    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe('2026.09.3');
    expect(service.hasUnseen()).toBe(false);
  });

  it('markCurrentAsSeen() does nothing when no releases have loaded', () => {
    const service = createService();

    service.markCurrentAsSeen();

    expect(localStorage.getItem(LAST_SEEN_KEY)).toBeNull();
  });

  it('markCurrentAsSeen() suppresses the dialog for the session even if storage refuses the write', async () => {
    // Private browsing can throw on write; the notice must still not re-fire mid-session.
    const service = createService();

    const loading = service.load();
    flushLoad([release('2026.09.3')]);
    await loading;

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(() => service.markCurrentAsSeen()).not.toThrow();
    expect(service.hasUnseen()).toBe(false);

    setItem.mockRestore();
  });
});
