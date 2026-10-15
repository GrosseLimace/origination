/**
 * Minimal promise wrapper over IndexedDB for the offline queue. Deliberately dependency-free
 * (no `idb`): two stores, four operations. Anything stored here is NOT encrypted by the app
 * (ADR-001 exception 4); only queued writes (which can include contact edits until they send) and non-PII
 * reference data may live here, and
 * `OfflineStore.wipe()` runs on sign-out.
 */
export const OFFLINE_DB_NAME = 'origination-mobile';
export const OFFLINE_DB_VERSION = 1;
export const STORE_SYNC_QUEUE = 'syncQueue';
export const STORE_KV = 'kv';

export type QueuedStatus = 'pending' | 'syncing' | 'synced' | 'error';

/** What a queued write does. Burdi queues every driver change; we queue every mobile write (user 2026-10-14). */
export type QueuedKind = 'note-create' | 'details-update' | 'planting-create' | 'planting-update';

export interface QueuedOperation<TBody = unknown> {
  id?: number;
  kind: QueuedKind;
  customerId: number;
  /** planting-update only: the intention being changed (also the merge key). */
  intentionId?: number;
  body: TBody;
  status: QueuedStatus;
  attempts: number;
  createdAt: string;
  lastError?: string;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class OfflineStore {
  private static dbPromise: Promise<IDBDatabase> | null = null;

  static available(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  static open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const open = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(STORE_SYNC_QUEUE)) {
            const queue = db.createObjectStore(STORE_SYNC_QUEUE, { keyPath: 'id', autoIncrement: true });
            queue.createIndex('status', 'status', { unique: false });
          }
          if (!db.objectStoreNames.contains(STORE_KV)) {
            db.createObjectStore(STORE_KV);
          }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
    }
    return this.dbPromise;
  }

  static async add(op: QueuedOperation): Promise<number> {
    const db = await this.open();
    const tx = db.transaction(STORE_SYNC_QUEUE, 'readwrite');
    return (await request(tx.objectStore(STORE_SYNC_QUEUE).add(op))) as number;
  }

  static async put(op: QueuedOperation): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE_SYNC_QUEUE, 'readwrite');
    await request(tx.objectStore(STORE_SYNC_QUEUE).put(op));
  }

  static async remove(id: number): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE_SYNC_QUEUE, 'readwrite');
    await request(tx.objectStore(STORE_SYNC_QUEUE).delete(id));
  }

  static async all(): Promise<QueuedOperation[]> {
    const db = await this.open();
    const tx = db.transaction(STORE_SYNC_QUEUE, 'readonly');
    return (await request(tx.objectStore(STORE_SYNC_QUEUE).getAll())) as QueuedOperation[];
  }

  /** Drops the whole database. Used on sign-out and on authentication failure. */
  static async wipe(): Promise<void> {
    if (!this.available()) return;
    if (this.dbPromise) {
      try { (await this.dbPromise).close(); } catch { /* already closed */ }
      this.dbPromise = null;
    }
    await new Promise<void>((resolve) => {
      const del = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
      del.onsuccess = () => resolve();
      del.onerror = () => resolve();
      del.onblocked = () => resolve();
    });
  }
}
