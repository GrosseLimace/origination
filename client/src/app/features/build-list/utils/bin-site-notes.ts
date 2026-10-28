/**
 * Build a List, Grain on Farm & Bin Sites prompts: planning the note requests that find each
 * producer's notes naming one of their bin sites. Moved verbatim out of
 * BuildListComponent._loadBinSiteNotes; the page still sends the requests and keeps the results.
 */
import { Customer } from '@models';
import { binSiteNames } from '@shared/utils/bin-site-mentions';

/** One notes request: the producers it covers, their "customerId:site names" keys, the site names
 *  to search for, and its estimated query-string length. */
export interface BinNoteChunk { ids: number[]; keys: string[]; names: Set<string>; length: number }

/**
 * Splits the producers that have named bin sites (skipping keys already fetched — a renamed site
 * changes the key, so it refetches) into requests whose ids + URL-encoded site names stay under
 * `budget` characters. A single producer whose names alone pass the budget gets a chunk of its own;
 * see binNoteContentAny for how that one is sent.
 */
export function planBinSiteNoteChunks(customers: Customer[], fetchedKeys: ReadonlySet<string>, budget: number): BinNoteChunk[] {
  const chunks: BinNoteChunk[] = [];
  let chunk: BinNoteChunk = { ids: [], keys: [], names: new Set(), length: 0 };
  for (const c of customers) {
    const siteNames = binSiteNames(c.binSites);
    if (siteNames.length === 0) continue;
    const key = `${c.id}:${siteNames.join('|').toLowerCase()}`;
    if (fetchedKeys.has(key)) continue;
    const cost = (names: Set<string>) => String(c.id).length + 3
      + siteNames.filter(n => !names.has(n)).reduce((sum, n) => sum + encodeURIComponent(n).length + 3, 0);
    if (chunk.ids.length > 0 && chunk.length + cost(chunk.names) > budget) {
      chunks.push(chunk);
      chunk = { ids: [], keys: [], names: new Set(), length: 0 };
    }
    chunk.length += cost(chunk.names);
    chunk.ids.push(c.id);
    chunk.keys.push(key);
    siteNames.forEach(n => chunk.names.add(n));
  }
  if (chunk.ids.length > 0) chunks.push(chunk);
  return chunks;
}

/** The site names to send for a chunk — none (fetch by id only; the client still matches) when the
 *  chunk alone is over budget. */
export function binNoteContentAny(chunk: BinNoteChunk, budget: number): string[] | undefined {
  return chunk.length > budget ? undefined : [...chunk.names];
}
