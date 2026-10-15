import { messageFor } from '../../../core/errors/mobile-error.handler';
import { BinSite, ContactUpdate, GrainOnFarmItem } from '../../../core/api/mobile-api.service';

/** A bin site with its key always set (legacy sites get one when read) so grain can point at it. */
export type Site = BinSite & { siteKey: string };

/** The producer's farm record as last read: what every save sends back, with one change applied. */
export interface FarmRecord {
  acres: number | null;
  sites: Site[];
  grain: GrainOnFarmItem[];
  modifiedAt: string | null;
  modifiedBy: string | null;
}

/** One save from the Overview. Anything not given goes back exactly as read (contacts: kept as stored). */
export interface FarmChange {
  acres?: number | null;
  sites?: Site[];
  grain?: GrainOnFarmItem[];
  contacts?: ContactUpdate[];
}

/** Saves a change; resolves when saved, rejects (error already shown to the user) when it failed. */
export type SaveFn = (change: FarmChange) => Promise<void>;

/** "1,200" / "1200" / "" → number or null. Commas allowed, like the desktop's grouped inputs. */
export function numberOrNull(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = String(value).replace(/,/g, '').trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Shared input look: big enough to tap on a phone. */
export const INPUT_CLASS =
  'mt-1 w-full h-11 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 text-base text-gray-900 dark:text-gray-100';

/** The message for a failed save. The form stays open with the edits, so "no connection" says so. */
export function saveErrorMessage(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  if (status === 0) return 'No connection. Your changes are still on screen — tap Save again when you have signal.';
  return messageFor(error) ?? "Couldn't save. Try again.";
}
