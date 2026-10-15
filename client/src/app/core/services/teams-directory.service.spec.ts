import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, Subject, throwError, of } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { GraphTeamsChannel, TeamsDirectoryService } from './teams-directory.service';

/**
 * The @-mention picker's Teams channel list. Pins the two promises the picker relies on:
 *  - one API call per session, shared by every subscriber (including ones that arrive mid-flight),
 *  - failure (e.g. no admin consent yet in this environment) degrades to an empty list, never an error.
 */

function channel(over: Partial<GraphTeamsChannel> = {}): GraphTeamsChannel {
  return {
    teamId: 't1',
    teamName: 'Origination',
    channelId: 'c1',
    displayName: 'General',
    channelEmail: 'general@scoular.example',
    ...over,
  };
}

describe('TeamsDirectoryService', () => {
  let getMyTeamsChannels: ReturnType<typeof vi.fn>;
  let service: TeamsDirectoryService;

  beforeEach(() => {
    getMyTeamsChannels = vi.fn(() => of([channel()]));
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: { getMyTeamsChannels } }] });
    service = TestBed.inject(TeamsDirectoryService);
  });

  it('returns the channels the API reports for the signed-in user', async () => {
    expect(await firstValueFrom(service.getChannels())).toEqual([channel()]);
  });

  it('calls the API once per session however many times the picker asks', async () => {
    await firstValueFrom(service.getChannels());
    await firstValueFrom(service.getChannels());
    await firstValueFrom(service.getChannels());

    expect(getMyTeamsChannels).toHaveBeenCalledTimes(1);
  });

  it('shares a single in-flight request between concurrent subscribers', () => {
    const response = new Subject<GraphTeamsChannel[]>();
    getMyTeamsChannels.mockReturnValue(response);
    const seen: GraphTeamsChannel[][] = [];

    service.getChannels().subscribe(c => seen.push(c));
    service.getChannels().subscribe(c => seen.push(c));
    response.next([channel({ channelId: 'c2' })]);
    response.complete();

    expect(getMyTeamsChannels).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([[channel({ channelId: 'c2' })], [channel({ channelId: 'c2' })]]);
  });

  it('degrades to an empty list when the API fails, without erroring the picker', async () => {
    getMyTeamsChannels.mockReturnValue(throwError(() => new Error('403 consent required')));

    expect(await firstValueFrom(service.getChannels())).toEqual([]);
  });

  it('caches the empty fallback too, so a failing environment is not re-asked on every keystroke', async () => {
    getMyTeamsChannels.mockReturnValue(throwError(() => new Error('403')));

    await firstValueFrom(service.getChannels());
    await firstValueFrom(service.getChannels());

    expect(getMyTeamsChannels).toHaveBeenCalledTimes(1);
  });
});
