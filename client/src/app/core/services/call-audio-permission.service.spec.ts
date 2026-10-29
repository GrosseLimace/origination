import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import {
  CALL_AUDIO_BLOCKED_HINT_KEY,
  CALL_AUDIO_NOT_NOW_KEY,
  CallAudioPermissionService,
} from './call-audio-permission.service';
import { ToastService } from './toast.service';

/** A PermissionStatus stand-in: a state plus a real 'change' event. */
class FakePermissionStatus extends EventTarget {
  constructor(public state: PermissionState) { super(); }
  change(next: PermissionState) {
    this.state = next;
    this.dispatchEvent(new Event('change'));
  }
}

describe('CallAudioPermissionService', () => {
  let status: FakePermissionStatus;
  let query: ReturnType<typeof vi.fn>;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let tracks: { stop: ReturnType<typeof vi.fn> }[];
  let toast: { error: ReturnType<typeof vi.fn> };
  const originalPermissions = Object.getOwnPropertyDescriptor(navigator, 'permissions');
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

  function stubNavigator(permissions: unknown, mediaDevices: unknown = { getUserMedia }) {
    Object.defineProperty(navigator, 'permissions', { value: permissions, configurable: true });
    Object.defineProperty(navigator, 'mediaDevices', { value: mediaDevices, configurable: true });
  }

  function create(): CallAudioPermissionService {
    TestBed.configureTestingModule({ providers: [{ provide: ToastService, useValue: toast }] });
    return TestBed.inject(CallAudioPermissionService);
  }

  beforeEach(() => {
    sessionStorage.clear();
    status = new FakePermissionStatus('prompt');
    query = vi.fn().mockResolvedValue(status);
    tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => tracks });
    toast = { error: vi.fn() };
    stubNavigator({ query });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    if (originalPermissions) Object.defineProperty(navigator, 'permissions', originalPermissions);
    else delete (navigator as unknown as Record<string, unknown>)['permissions'];
    if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
    else delete (navigator as unknown as Record<string, unknown>)['mediaDevices'];
    sessionStorage.clear();
  });

  it('shows nothing and never touches the device before this tab is the call endpoint', () => {
    const service = create();

    expect(service.hasNotice()).toBe(false);
    expect(query).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('granted: no banner, no hint, no device access', async () => {
    status.state = 'granted';
    const service = create();

    await service.activate();

    expect(query).toHaveBeenCalledWith({ name: 'microphone' });
    expect(service.permission()).toBe('granted');
    expect(service.hasNotice()).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('prompt: shows the enable banner without opening the microphone', async () => {
    const service = create();

    await service.activate();

    expect(service.showEnableBanner()).toBe(true);
    expect(service.showBlockedHint()).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('Enable asks once and releases every track immediately, then hides the banner', async () => {
    const service = create();
    await service.activate();

    await service.enable();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    tracks.forEach(t => expect(t.stop).toHaveBeenCalledTimes(1));
    expect(service.permission()).toBe('granted');
    expect(service.showEnableBanner()).toBe(false);
  });

  it('Enable refused in the browser prompt: switches to the blocked hint', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const service = create();
    await service.activate();

    await service.enable();

    expect(service.permission()).toBe('denied');
    expect(service.showEnableBanner()).toBe(false);
    expect(service.showBlockedHint()).toBe(true);
  });

  it('Enable with no usable microphone: tells the user, keeps the banner', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('none'), { name: 'NotFoundError' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = create();
    await service.activate();

    await service.enable();

    expect(toast.error).toHaveBeenCalled();
    expect(service.showEnableBanner()).toBe(true);
    warn.mockRestore();
  });

  it('Not now hides the banner for the session, including for a later page in the same session', async () => {
    const service = create();
    await service.activate();

    service.dismissEnableBanner();

    expect(service.showEnableBanner()).toBe(false);
    expect(sessionStorage.getItem(CALL_AUDIO_NOT_NOW_KEY)).toBe('1');

    TestBed.resetTestingModule(); // a fresh service, as after a reload in the same tab
    const again = create();
    await again.activate();
    expect(again.permission()).toBe('prompt');
    expect(again.showEnableBanner()).toBe(false);
  });

  it('denied: shows the blocked hint, never calls getUserMedia, and the hint can be dismissed', async () => {
    status.state = 'denied';
    const service = create();

    await service.activate();

    expect(service.showBlockedHint()).toBe(true);
    expect(service.showEnableBanner()).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();

    service.dismissBlockedHint();
    expect(service.showBlockedHint()).toBe(false);
    expect(sessionStorage.getItem(CALL_AUDIO_BLOCKED_HINT_KEY)).toBe('1');
  });

  it('falls back to prompt when the permissions query throws (e.g. "microphone" unsupported)', async () => {
    query.mockRejectedValue(new TypeError("'microphone' is not a valid PermissionName"));
    const service = create();

    await service.activate();

    expect(service.permission()).toBe('prompt');
    expect(service.showEnableBanner()).toBe(true);
  });

  it('falls back to prompt when the Permissions API is missing altogether', async () => {
    stubNavigator(undefined);
    const service = create();

    await service.activate();

    expect(service.permission()).toBe('prompt');
    expect(service.showEnableBanner()).toBe(true);
  });

  it('follows site-settings changes through the PermissionStatus change event', async () => {
    const service = create();
    await service.activate();
    expect(service.showEnableBanner()).toBe(true);

    status.change('denied');
    expect(service.showBlockedHint()).toBe(true);

    status.change('granted');
    expect(service.hasNotice()).toBe(false);
  });

  it('deactivate hides the notices and stops following changes', async () => {
    const service = create();
    await service.activate();

    service.deactivate();
    status.change('denied');

    expect(service.hasNotice()).toBe(false);
    expect(service.permission()).toBe('prompt'); // the change after deactivate was not applied
  });

  it('activate is idempotent: one query per activation', async () => {
    const service = create();

    await service.activate();
    await service.activate();

    expect(query).toHaveBeenCalledTimes(1);
  });
});
