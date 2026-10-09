/**
 * Notes that mention one of a producer's bin sites by name (user 2026-10-09). Build a List shows them
 * on the Grain on Farm & Bin Sites prompts, in the result row's middle column where note prompts show
 * their matches.
 *
 * A site is mentioned when its whole name appears in the note text, case-insensitive, not inside a
 * longer word or number: "North Bins" matches "checked north bins today", and "Bin 1" matches "bin 1
 * is full" but not "bin 10". Note text is plain (the display escapes it), so no HTML to strip.
 */
import { Note, ProducerBinSiteItem } from '@models';

/** How a bin-site name looks inside note text — blue text, no highlight box (user 2026-10-09), the same
 *  in the producer Notes panel and on Build a List. Green stays reserved for @mentions. */
export const BIN_SITE_NAME_CLASS = 'font-medium text-blue-600 dark:text-blue-400';

/** The distinct, trimmed site names worth matching, in the producer's site order. */
export function binSiteNames(sites: readonly ProducerBinSiteItem[] | null | undefined): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const site of sites ?? []) {
    const name = site.name?.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return names;
}

/** Whole-name, case-insensitive matcher for one site name (inner spaces match any run of whitespace). */
export function binSiteMentionPattern(name: string): RegExp {
  // Not "-": it needs no escape outside a character class, and under the u flag "\-" is an error
  // (a site named "Hwy-30 Bins" would throw and blank the Notes panel / Build a List row).
  const escaped = name.trim().replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}

/**
 * The notes that mention at least one of the given site names — pinned first, then newest — and which
 * of the names were mentioned (in the order given). Null when none mention a site.
 */
export function notesMentioningBinSites<T extends Pick<Note, 'id' | 'content' | 'isPinned' | 'createdAt'>>(
  notes: readonly T[],
  siteNames: readonly string[],
): { notes: T[]; sites: string[] } | null {
  if (siteNames.length === 0 || notes.length === 0) return null;
  const patterns = siteNames.map(name => ({ name, re: binSiteMentionPattern(name) }));
  const mentioned = new Set<string>();
  const matched: T[] = [];
  for (const note of notes) {
    const text = note.content ?? '';
    let hit = false;
    for (const p of patterns) {
      if (p.re.test(text)) { hit = true; mentioned.add(p.name); }
    }
    if (hit) matched.push(note);
  }
  if (matched.length === 0) return null;
  const time = (n: T) => new Date(n.createdAt as unknown as string).getTime() || 0;
  matched.sort((a, b) => {
    if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
    return time(b) - time(a) || (b.id ?? 0) - (a.id ?? 0);
  });
  return { notes: matched, sites: siteNames.filter(n => mentioned.has(n)) };
}

/**
 * Splits note text into runs, marking each run that names one of the bin sites — the same matching
 * Build a List uses, so what the Notes panel highlights is exactly what shows there. Longest name
 * first ("North Bins" before "North"). Pure string work, no HTML — callers render the runs as text.
 */
export function splitByBinSiteNames(text: string, siteNames: readonly string[]): { text: string; bin: boolean }[] {
  if (!text) return [];
  const names = [...siteNames].filter(n => n.trim()).sort((a, b) => b.length - a.length);
  if (names.length === 0) return [{ text, bin: false }];
  const alternatives = names.map(n => binSiteMentionPattern(n).source).join('|');
  const re = new RegExp(alternatives, 'giu');
  const out: { text: string; bin: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), bin: false });
    out.push({ text: m[0], bin: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bin: false });
  return out;
}
