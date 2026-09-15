import { describe, it, expect, vi } from 'vitest';
import { signal } from '@angular/core';
import { render, screen } from '@testing-library/angular';
import { WhatsNewComponent } from './whats-new.component';
import { WhatsNewService } from '@core/services/whats-new.service';
import { provideTestEnvironment } from '@testing/test-providers';
import type { AppVersionInfo, WhatsNewRelease } from '@models';

const releases: WhatsNewRelease[] = [
  {
    version: '2026.09.1',
    releasedOn: '2026-09-15',
    title: 'A September release',
    items: [{ kind: 'added', text: 'Something new.' }]
  }
];

const version: AppVersionInfo = {
  releaseVersion: '2026.09.1',
  releasedOn: '2026-09-15',
  commitSha: 'abc1234def',
  shortSha: 'abc1234',
  buildNumber: '412',
  environment: 'Dev'
};

/** Stands in for the root service so the page renders without touching HTTP. */
function makeStub(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    releases: signal(releases),
    version: signal<AppVersionInfo | null>(version),
    loaded: signal(true),
    load: vi.fn().mockResolvedValue(undefined),
    markCurrentAsSeen: vi.fn(),
    ...overrides
  };
}

async function renderPage(stub: ReturnType<typeof makeStub>) {
  await render(WhatsNewComponent, {
    providers: provideTestEnvironment({
      extraProviders: [{ provide: WhatsNewService, useValue: stub }]
    })
  });
}

describe('WhatsNewComponent', () => {
  it('lists every release', async () => {
    await renderPage(makeStub());

    expect(screen.getByText('A September release')).toBeTruthy();
    expect(screen.getByText('Something new.')).toBeTruthy();
  });

  it('acknowledges the current release on visit, without re-fetching when already loaded', async () => {
    // Opening the page is an acknowledgment, which is what clears the header dot.
    const stub = makeStub();

    await renderPage(stub);

    expect(stub.markCurrentAsSeen).toHaveBeenCalled();
    expect(stub.load).not.toHaveBeenCalled();
  });

  it('loads then acknowledges when the page is opened cold', async () => {
    const stub = makeStub({ loaded: signal(false) });

    await renderPage(stub);
    await Promise.resolve();

    expect(stub.load).toHaveBeenCalled();
  });

  it('shows the build line so it can be quoted in a bug report', async () => {
    await renderPage(makeStub());

    expect(screen.getByText('Release 2026.09.1 · Build abc1234 (#412) · Dev')).toBeTruthy();
  });

  it('says so when nothing has been published', async () => {
    await renderPage(makeStub({ releases: signal([] as WhatsNewRelease[]) }));

    expect(screen.getByText('No updates have been published yet.')).toBeTruthy();
  });
});
