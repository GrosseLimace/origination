import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';

import {
  MobileApiService,
  NoteCreate,
  PlantingIntentionCreate,
  PlantingIntentionUpdate,
  ProducerDetailsUpdate,
} from '../api/mobile-api.service';
import { messageFor } from '../errors/mobile-error.handler';
import { ConnectivityService } from './connectivity.service';
import { OfflineStore, QueuedKind, QueuedOperation } from './indexed-db';

/** Every write the phone can make. Each body carries its `clientRequestId`, so a resend is never a duplicate. */
export type QueuedWrite =
  | { kind: 'note-create'; customerId: number; body: NoteCreate }
  | { kind: 'details-update'; customerId: number; body: ProducerDetailsUpdate }
  | { kind: 'planting-create'; customerId: number; body: PlantingIntentionCreate }
  | { kind: 'planting-update'; customerId: number; intentionId: number; body: PlantingIntentionUpdate };

export type SubmitResult = 'sent' | 'queued';

/** No signal, or the server briefly unavailable: keep the write and try again. Anything else the server refused. */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) return true; // e.g. the token couldn't refresh without signal
  return error.status === 0 || error.status === 401 || error.status === 408 || error.status === 429 || error.status >= 500;
}

/**
 * Offline write queue, following Burdi's driver app (`sync.service.ts` + `storage.service.ts`):
 *
 * - Every change is kept on the phone (IndexedDB) and replayed in the order it was made when signal returns.
 * - Items stuck "syncing" from a previous session (app killed mid-send) are reset to pending on start.
 * - State is re-read from the store after every send, so anything queued meanwhile is picked up.
 * - The server's `clientRequestId` replay makes a resend after a half-delivered request a no-op, never a duplicate.
 *
 * Where we differ from Burdi, on purpose:
 * - Burdi retries a refused write forever. Here a write the server refuses (409 changed on the desktop, 400, 403,
 *   404) stops as "couldn't sync" with the reason, for the originator to discard or retry; the rest carry on.
 * - Two edits of the same record while offline merge into one (latest values), and after an edit is accepted any
 *   later queued edit of that record is re-based on the server's new version — so the second never conflicts with
 *   the first (Burdi orders by type instead: route, then loads, then updates).
 */
@Injectable({ providedIn: 'root' })
export class SyncQueueService {
  private readonly api = inject(MobileApiService);
  private readonly connectivity = inject(ConnectivityService);

  private readonly _items = signal<QueuedOperation[]>([]);
  /** Everything on the phone the server has not accepted yet, oldest first. */
  readonly items = this._items.asReadonly();
  readonly pendingCount = computed(() => this._items().length);
  /** Writes the server refused; they wait for the originator to discard or retry. */
  readonly failed = computed(() => this._items().filter((i) => i.status === 'error'));

  /** Set after each successful send so a page showing that producer can reload. */
  readonly synced = signal<{ customerId: number; kind: QueuedKind } | null>(null);

  private draining = false;
  private started = false;

  constructor() {
    effect(() => {
      if (this.connectivity.online() && this.started) {
        void this.drain();
      }
    });
  }

  start(): void {
    if (this.started || !OfflineStore.available()) return;
    this.started = true;
    void this.resetStuck().then(() => this.drain());

    // Phones often report "online" on a signal too weak to reach us, so the online event alone (Burdi) can leave
    // changes waiting. Also try when the app comes back to the front, and every minute while anything waits.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.hasWaiting()) void this.drain();
      });
    }
    setInterval(() => { if (this.hasWaiting()) void this.drain(); }, 60_000);
  }

  private hasWaiting(): boolean {
    return this._items().some((i) => i.status === 'pending');
  }

  /**
   * Send now when there is signal; keep it on the phone when there isn't (or the send fails for lack of it).
   * A write behind another queued write for the same record joins the queue so the order holds.
   * Errors the server returns (409, 400, …) are thrown to the caller, so the form stays open as before.
   */
  async submit(write: QueuedWrite): Promise<SubmitResult> {
    const queueBehind = this._items().some((i) => i.status !== 'error' && sameRecord(i, write));
    if (this.connectivity.online() && !queueBehind) {
      try {
        await this.send(write);
        return 'sent';
      } catch (error) {
        const noSignal = error instanceof HttpErrorResponse && error.status === 0;
        if (!noSignal || !OfflineStore.available()) throw error;
      }
    }
    if (!OfflineStore.available()) throw new HttpErrorResponse({ status: 0, statusText: 'Offline' });
    await this.enqueue(write);
    return 'queued';
  }

  /** Queued writes for one producer, oldest first. */
  forCustomer(customerId: number): QueuedOperation[] {
    return this._items().filter((i) => i.customerId === customerId);
  }

  async discard(id: number): Promise<void> {
    await OfflineStore.remove(id);
    await this.refresh();
  }

  async retry(id: number): Promise<void> {
    const item = this._items().find((i) => i.id === id);
    if (!item) return;
    await OfflineStore.put({ ...item, status: 'pending', lastError: undefined });
    await this.refresh();
    void this.drain();
  }

  async drain(): Promise<void> {
    if (this.draining || !OfflineStore.available() || !this.connectivity.online()) return;
    this.draining = true;
    try {
      // One at a time, re-reading the store each time (Burdi re-reads after every API call).
      for (;;) {
        const next = (await OfflineStore.all()).filter((i) => i.status === 'pending').sort(byOrder)[0];
        if (!next || !this.connectivity.online()) break;
        if (!(await this.replay(next))) break; // lost signal: stop, the next reconnect resumes
      }
    } catch {
      // Storage itself failed; nothing is lost, the next reconnect tries again.
    } finally {
      this.draining = false;
      await this.refresh().catch(() => undefined);
    }
  }

  /** Returns false when the queue should stop for now (no signal), true to carry on. */
  private async replay(item: QueuedOperation): Promise<boolean> {
    await OfflineStore.put({ ...item, status: 'syncing', attempts: item.attempts + 1 });
    await this.refresh();
    try {
      const result = await this.send(item as QueuedWrite);
      await OfflineStore.remove(item.id!);
      await this.rebase(item, result);
      this.synced.set({ customerId: item.customerId, kind: item.kind });
      return true;
    } catch (error) {
      const retry = isRetryable(error);
      await OfflineStore.put({
        ...item,
        attempts: item.attempts + 1,
        status: retry ? 'pending' : 'error',
        lastError: messageFor(error) ?? (retry ? 'No connection.' : "The server didn't accept this change."),
      });
      return !retry; // a refused write doesn't hold up the others; lost signal does
    }
  }

  private send(write: QueuedWrite): Promise<unknown> {
    switch (write.kind) {
      case 'note-create': return this.api.createNote(write.customerId, write.body);
      case 'details-update': return this.api.updateProducerDetails(write.customerId, write.body);
      case 'planting-create': return this.api.createPlantingIntention(write.customerId, write.body);
      case 'planting-update': return this.api.updatePlantingIntention(write.customerId, write.intentionId, write.body);
    }
  }

  private async enqueue(write: QueuedWrite): Promise<void> {
    const waiting = (await OfflineStore.all()).find((i) => i.status === 'pending' && sameRecord(i, write));
    if (waiting) {
      // Merge into the edit already waiting: latest values win, anything only the earlier edit sent (e.g. contacts)
      // is kept, and it stays based on the version that edit was read from.
      const earlier = waiting.body as { expectedModifiedAt?: string | null };
      await OfflineStore.put({ ...waiting, body: { ...earlier, ...write.body, expectedModifiedAt: earlier.expectedModifiedAt ?? null } });
    } else {
      await OfflineStore.add({ ...write, status: 'pending', attempts: 0, createdAt: new Date().toISOString() });
    }
    await this.refresh();
    if (this.connectivity.online()) void this.drain();
  }

  /** After an edit is accepted, later queued edits of the same record are based on the server's new version. */
  private async rebase(sent: QueuedOperation, result: unknown): Promise<void> {
    const modifiedAt = (result as { modifiedAt?: string | null } | null)?.modifiedAt;
    if (!modifiedAt || (sent.kind !== 'details-update' && sent.kind !== 'planting-update')) return;
    for (const later of (await OfflineStore.all()).filter((i) => i.status === 'pending' && sameRecord(i, sent))) {
      await OfflineStore.put({ ...later, body: { ...(later.body as object), expectedModifiedAt: modifiedAt } });
    }
  }

  private async resetStuck(): Promise<void> {
    for (const item of (await OfflineStore.all()).filter((i) => i.status === 'syncing')) {
      await OfflineStore.put({ ...item, status: 'pending' });
    }
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    this._items.set((await OfflineStore.all()).filter((i) => i.status !== 'synced').sort(byOrder));
  }
}

/** Edits of one record merge and re-base; creates never do. */
function sameRecord(a: Pick<QueuedOperation, 'kind' | 'customerId' | 'intentionId'>, b: Pick<QueuedOperation, 'kind' | 'customerId' | 'intentionId'>): boolean {
  if (a.kind !== b.kind || a.customerId !== b.customerId) return false;
  if (a.kind === 'details-update') return true;
  if (a.kind === 'planting-update') return a.intentionId === b.intentionId;
  return false;
}

function byOrder(a: QueuedOperation, b: QueuedOperation): number {
  return a.createdAt.localeCompare(b.createdAt) || (a.id ?? 0) - (b.id ?? 0);
}
