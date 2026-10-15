import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileApiService } from '../api/mobile-api.service';
import { ConnectivityService } from './connectivity.service';
import { OfflineStore, QueuedOperation } from './indexed-db';
import { SyncQueueService, isRetryable } from './sync-queue.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The phone's IndexedDB queue, in memory. */
function fakeStore(): Map<number, QueuedOperation> {
  const rows = new Map<number, QueuedOperation>();
  let next = 1;
  vi.spyOn(OfflineStore, 'available').mockReturnValue(true);
  vi.spyOn(OfflineStore, 'all').mockImplementation(async () => [...rows.values()].map((r) => structuredClone(r)));
  vi.spyOn(OfflineStore, 'add').mockImplementation(async (op) => { const id = next++; rows.set(id, structuredClone({ ...op, id })); return id; });
  vi.spyOn(OfflineStore, 'put').mockImplementation(async (op) => { rows.set(op.id!, structuredClone(op)); });
  vi.spyOn(OfflineStore, 'remove').mockImplementation(async (id) => { rows.delete(id); });
  return rows;
}

const noSignal = () => new HttpErrorResponse({ status: 0 });
const conflict = () => new HttpErrorResponse({ status: 409, error: { message: 'Changed by someone else.' } });

describe('SyncQueueService (Burdi-style offline queue)', () => {
  let rows: Map<number, QueuedOperation>;
  const online = signal(true);
  const api = {
    createNote: vi.fn(),
    updateProducerDetails: vi.fn(),
    createPlantingIntention: vi.fn(),
    updatePlantingIntention: vi.fn(),
  };

  function create(): SyncQueueService {
    TestBed.configureTestingModule({
      providers: [
        { provide: MobileApiService, useValue: api },
        { provide: ConnectivityService, useValue: { online } },
      ],
    });
    return TestBed.inject(SyncQueueService);
  }

  beforeEach(() => {
    rows = fakeStore();
    online.set(true);
    Object.values(api).forEach((f) => f.mockReset());
  });
  afterEach(() => vi.restoreAllMocks());

  it('sends straight away with signal and keeps nothing', async () => {
    api.createNote.mockResolvedValue({ id: 1 });
    const queue = create();

    const result = await queue.submit({ kind: 'note-create', customerId: 7, body: { clientRequestId: 'a', content: 'hi' } as any });

    expect(result).toBe('sent');
    expect(rows.size).toBe(0);
  });

  it('keeps the change on the phone without signal, then sends it when signal returns', async () => {
    online.set(false);
    const queue = create();
    queue.start();

    const result = await queue.submit({ kind: 'planting-create', customerId: 7, body: { clientRequestId: 'c', crop: 'YC', acres: 10, plantingYear: 2027 } as any });
    expect(result).toBe('queued');
    expect(queue.pendingCount()).toBe(1);
    expect(api.createPlantingIntention).not.toHaveBeenCalled();

    api.createPlantingIntention.mockResolvedValue({ id: 9 });
    online.set(true);
    await queue.drain();

    expect(api.createPlantingIntention).toHaveBeenCalledWith(7, expect.objectContaining({ clientRequestId: 'c' }));
    expect(rows.size).toBe(0);
    expect(queue.synced()).toEqual({ customerId: 7, kind: 'planting-create' });
  });

  it('keeps the change when the send drops mid-way (status 0), with the same request id for the resend', async () => {
    api.updateProducerDetails.mockRejectedValueOnce(noSignal());
    const queue = create();

    const result = await queue.submit({ kind: 'details-update', customerId: 7, body: { clientRequestId: 'd1', totalAcres: 500 } as any });

    expect(result).toBe('queued');
    expect([...rows.values()][0].body).toMatchObject({ clientRequestId: 'd1', totalAcres: 500 });
  });

  it('still throws what the server refused, so the form stays open', async () => {
    api.updateProducerDetails.mockRejectedValueOnce(conflict());
    const queue = create();

    await expect(queue.submit({ kind: 'details-update', customerId: 7, body: { clientRequestId: 'x' } as any })).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(rows.size).toBe(0);
  });

  it('merges two offline edits of the same record: latest values, earlier-only fields kept, original version', async () => {
    online.set(false);
    const queue = create();

    await queue.submit({ kind: 'details-update', customerId: 7, body: { clientRequestId: '1', totalAcres: 100, contacts: [{ name: 'Pat', isPrimary: true }], expectedModifiedAt: 'v1' } as any });
    await queue.submit({ kind: 'details-update', customerId: 7, body: { clientRequestId: '2', totalAcres: 200, expectedModifiedAt: 'v1' } as any });

    expect(rows.size).toBe(1);
    expect([...rows.values()][0].body).toMatchObject({ totalAcres: 200, contacts: [{ name: 'Pat', isPrimary: true }], expectedModifiedAt: 'v1' });
  });

  it('replays in the order made and re-bases a later edit on the version the earlier one produced', async () => {
    online.set(false);
    const queue = create();
    await queue.submit({ kind: 'planting-update', customerId: 7, intentionId: 5, body: { clientRequestId: '1', acres: 10, expectedModifiedAt: 'v1' } as any });
    // A sent-but-not-confirmed edit is "syncing"; a second edit made then must not merge into it.
    const first = [...rows.values()][0];
    rows.set(first.id!, { ...first, status: 'syncing' });
    await (queue as any).refresh();
    await queue.submit({ kind: 'planting-update', customerId: 7, intentionId: 5, body: { clientRequestId: '2', acres: 20, expectedModifiedAt: 'v1' } as any });
    rows.set(first.id!, { ...first, status: 'pending' });

    const calls: unknown[] = [];
    api.updatePlantingIntention.mockImplementation(async (_c: number, _i: number, body: any) => { calls.push(body); return { id: 5, modifiedAt: body.acres === 10 ? 'v2' : 'v3' }; });
    online.set(true);
    await queue.drain();

    expect(calls).toEqual([
      expect.objectContaining({ acres: 10, expectedModifiedAt: 'v1' }),
      expect.objectContaining({ acres: 20, expectedModifiedAt: 'v2' }),
    ]);
    expect(rows.size).toBe(0);
  });

  it("parks a refused change as couldn't-sync with the reason, and carries on with the rest", async () => {
    online.set(false);
    const queue = create();
    await queue.submit({ kind: 'details-update', customerId: 7, body: { clientRequestId: 'd' } as any });
    await queue.submit({ kind: 'note-create', customerId: 7, body: { clientRequestId: 'n', content: 'x' } as any });

    api.updateProducerDetails.mockRejectedValue(conflict());
    api.createNote.mockResolvedValue({ id: 1 });
    online.set(true);
    await queue.drain();

    expect(api.createNote).toHaveBeenCalled();
    expect(queue.failed()).toHaveLength(1);
    expect(queue.failed()[0]).toMatchObject({ kind: 'details-update', status: 'error' });
    expect(queue.failed()[0].lastError).toBeTruthy();

    await queue.discard(queue.failed()[0].id!);
    expect(rows.size).toBe(0);
    expect(queue.pendingCount()).toBe(0);
  });

  it('stops and keeps everything when signal drops during the replay', async () => {
    online.set(false);
    const queue = create();
    await queue.submit({ kind: 'note-create', customerId: 7, body: { clientRequestId: 'n1', content: 'a' } as any });
    await queue.submit({ kind: 'note-create', customerId: 7, body: { clientRequestId: 'n2', content: 'b' } as any });

    api.createNote.mockRejectedValue(noSignal());
    online.set(true);
    await queue.drain();

    expect(api.createNote).toHaveBeenCalledTimes(1);
    expect([...rows.values()].every((r) => r.status === 'pending')).toBe(true);
  });

  it('resets changes left "syncing" by an app that was closed mid-send', async () => {
    rows.set(1, { id: 1, kind: 'note-create', customerId: 7, body: { clientRequestId: 'n', content: 'a' }, status: 'syncing', attempts: 1, createdAt: '2026-10-15T00:00:00Z' });
    online.set(false);
    const queue = create();
    queue.start();
    await vi.waitFor(() => expect(rows.get(1)?.status).toBe('pending'));
  });

  it('treats no signal, sign-in and server trouble as retryable, and refusals as final', () => {
    expect([0, 401, 408, 429, 500, 503].every((status) => isRetryable(new HttpErrorResponse({ status })))).toBe(true);
    expect([400, 403, 404, 409].some((status) => isRetryable(new HttpErrorResponse({ status })))).toBe(false);
  });
});
