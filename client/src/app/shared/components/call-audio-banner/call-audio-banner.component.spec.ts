import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';

import { CallAudioBannerComponent } from './call-audio-banner.component';
import { CallAudioPermissionService } from '@core/services/call-audio-permission.service';
import { provideTestEnvironment } from '@testing/test-providers';

/** Hand-driven stand-in: the banner only reads signals and calls methods. */
function makeAudioStub() {
  return {
    showEnableBanner: signal(false),
    showBlockedHint: signal(false),
    enabling: signal(false),
    enable: vi.fn(),
    dismissEnableBanner: vi.fn(),
    dismissBlockedHint: vi.fn(),
  };
}

describe('CallAudioBannerComponent', () => {
  let audio: ReturnType<typeof makeAudioStub>;

  async function setup() {
    return render(CallAudioBannerComponent, {
      providers: provideTestEnvironment({ extraProviders: [{ provide: CallAudioPermissionService, useValue: audio }] }),
    });
  }

  beforeEach(() => {
    audio = makeAudioStub();
  });

  it('renders nothing when there is no notice', async () => {
    await setup();

    expect(screen.queryByTestId('call-audio-enable-banner')).toBeNull();
    expect(screen.queryByTestId('call-audio-blocked-hint')).toBeNull();
  });

  it('offers Enable and Not now when the browser would still ask', async () => {
    audio.showEnableBanner.set(true);
    await setup();
    const user = userEvent.setup();

    expect(screen.getByText(/Enable call audio so you can answer Teams calls here/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Enable' }));
    expect(audio.enable).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(audio.dismissEnableBanner).toHaveBeenCalledTimes(1);
  });

  it('disables Enable while the browser prompt is open', async () => {
    audio.showEnableBanner.set(true);
    audio.enabling.set(true);
    await setup();

    expect((screen.getByRole('button', { name: 'Enable' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('explains how to unblock the microphone, and can be dismissed', async () => {
    audio.showBlockedHint.set(true);
    await setup();
    const user = userEvent.setup();

    expect(screen.getByTestId('call-audio-blocked-hint').textContent).toContain('microphone is blocked for this site');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(audio.dismissBlockedHint).toHaveBeenCalledTimes(1);
  });
});
