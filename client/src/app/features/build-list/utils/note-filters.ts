/**
 * Build a List note prompts: whether a prompt/refinement reads notes, which notes it shows
 * inline, how much of the note set it has to fetch, and the last-contact badge.
 *
 * Pure functions moved verbatim out of BuildListComponent. The page wires them to its signals
 * (and passes the NLQ author matcher / keyword extractor in), so each computed still reads the
 * same signals it did.
 */
import { Customer, Note, NoteLastContact, RefinementFilters } from '@models';

/** A matching note tagged with the customer it was placed on — "{Name} ({Code})", or "({Code})". */
export type MatchedNote = Note & { viaName: string };

/** Server-side narrowing for a 'scoped' note fetch (ApiService.getNotes options). */
export interface NoteScopeOptions { sinceDays?: number; contentAny?: string[]; authorAny?: string[]; pinnedOnly?: boolean }

/** The note load a prompt needs — see noteScope. */
export type NoteScope = { mode: 'none' } | { mode: 'full' } | { mode: 'batched' } | { mode: 'scoped'; key: string; opts: NoteScopeOptions };

export const NLQ_NOTE_VERB = /notes?\s+(?:added|made|entered|written|created|left)/;

/** Parses a note's createdAt as UTC. The API stores DateTime.UtcNow without a 'Z' suffix,
 *  so a bare ISO string would be interpreted by the browser as local time — for a CST user
 *  that drifts cutoff comparisons by 6 hours and would mis-bucket "today"/"yesterday". */
export function parseNoteTime(ts: string | Date): number {
  const raw = typeof ts === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts + 'Z' : ts;
  return new Date(raw).getTime();
}

/** Pure predicate behind noteFilterActive() — split out so the readiness machinery
 *  (_criteriaReadiness / _commitRefinements) can evaluate it against a STAGED refinement
 *  set that hasn't been committed to appliedRefinements yet. */
export function isNoteFilterActive(r: RefinementFilters, queryText: string): boolean {
  if (r.notesInLastDays != null && r.notesInLastDays > 0) return true;
  if (r.noteKeyword?.trim()) return true;
  if (r.hasPinnedNotes) return true;
  if (r.contactedByMeOnly || r.contactedBySomeoneElse) return true;
  if (r.contactedOnlyOnce || r.contactedMoreThan5) return true;
  if (r.neverContacted) return true;
  if (r.notContactedDays != null && r.notContactedDays > 0) return true;

  const q = queryText.toLowerCase();
  if (/\b(?:contacted|called|reached\s+out)\b/.test(q)) return true;
  return NLQ_NOTE_VERB.test(q)
      || /pinned\s+note/.test(q)
      || /(?:with|has|have)\s+notes?\b/.test(q)
      || /notes?\s+(?:about|mentioning|containing|saying)/.test(q);
}

/** Predicate that matches a note against whichever note criteria are active. `deps` supplies the
 *  signed-in user's author candidates and the NLQ author matcher (NlqFilterService). */
export function buildNoteFilterPredicate(
  r: RefinementFilters,
  queryText: string,
  deps: { authorCandidates: () => string[]; matchesAuthor: (createdBy: string | null | undefined, candidates: string[]) => boolean },
): (n: Note) => boolean {
  const q = queryText.toLowerCase();
  const hasContactVerb = /\b(?:contacted|called|reached\s+out)\b/.test(q);
  // Absence prompts (never / haven't contacted): show ALL notes for the producer so the
  // user can see prior context regardless of recency. The "N days" in "haven't contacted
  // in 30 days" is a property of the producer match, not a date filter on notes shown.
  const isAbsenceQuery = r.neverContacted
    || (r.notContactedDays != null && r.notContactedDays > 0)
    || /never\s+contacted|haven'?t\s+contacted|not\s+(?:been\s+)?contacted|haven'?t\s+called/.test(q);

  let cutoffMs: number | null = null;
  if (!isAbsenceQuery) {
    if (r.notesInLastDays != null && r.notesInLastDays > 0) {
      cutoffMs = Date.now() - r.notesInLastDays * 86400000;
    } else if (NLQ_NOTE_VERB.test(q) || hasContactVerb) {
      // Numeric "in last N days" parsing works for both note-verb and contact-verb queries.
      const numeric = q.match(/(?:notes?\s+(?:added|made|entered|written|created|left)|contacted|called|reach(?:ed)?\s+out)\s*(?:in|within)?\s*(?:the\s+)?(?:last|past)?\s*(\d+)\s*days?/);
      if (numeric) cutoffMs = Date.now() - parseInt(numeric[1], 10) * 86400000;
      else if (q.includes('today')) cutoffMs = Date.now() - 1 * 86400000;
      else if (q.includes('yesterday')) cutoffMs = Date.now() - 2 * 86400000;
      else if (q.includes('this week') || q.includes('last week')) cutoffMs = Date.now() - 7 * 86400000;
      else if (q.includes('this month') || q.includes('last month')) cutoffMs = Date.now() - 30 * 86400000;
    }
  }

  // Keyword extraction: prefer the structured refinement; otherwise pull a quoted or "mentioning X"
  // fragment out of the NLQ query so the inline display matches what the user actually asked for.
  let keyword = r.noteKeyword?.trim().toLowerCase() || null;
  if (!keyword) {
    const quoted = q.match(/notes?\s+(?:about|mentioning|containing|saying|with)\s+["']([^"']+)["']/);
    if (quoted) keyword = quoted[1].trim().toLowerCase();
    else {
      const bare = q.match(/notes?\s+(?:about|mentioning|containing|saying)\s+([\w-]+(?:\s+[\w-]+){0,2})/);
      if (bare) keyword = bare[1].trim().toLowerCase();
    }
  }
  const requirePinned = !!r.hasPinnedNotes || /pinned\s+note/.test(q);

  // Author candidates for "by me" / "by someone else" filters. Same matcher the
  // service uses so saved-list "I contacted" filters work even when notes' CreatedBy
  // arrives as the raw UPN (e.g. "CEgr@scoular.com") instead of a display name.
  const authorCandidates = deps.authorCandidates();
  // Implicit "by me" when query starts with "I contacted / called / reached out"
  const queryImpliesByMe = /^[^a-z]*(?:producers?\s+)?i\s+(?:contacted|called|reached\s+out)\b/.test(q);
  const requireByMe = r.contactedByMeOnly || queryImpliesByMe;
  const requireByOthers = r.contactedBySomeoneElse;

  return (n: Note) => {
    if (cutoffMs != null) {
      const t = parseNoteTime(n.createdAt);
      if (!t || t < cutoffMs) return false;
    }
    if (keyword && !(n.content || '').toLowerCase().includes(keyword)) return false;
    if (requirePinned && !n.isPinned) return false;
    if (requireByMe && !deps.matchesAuthor(n.createdBy, authorCandidates)) return false;
    if (requireByOthers && deps.matchesAuthor(n.createdBy, authorCandidates)) return false;
    return true;
  };
}

/** Notes matching `predicate`, indexed by source customerCode, pinned first then newest first.
 *  Each note is tagged with `viaName = "{Name} ({Code})"` of the customer it was
 *  placed on — applied uniformly to every note so the origin is always visible. */
export function indexMatchingNotesByCode(predicate: (n: Note) => boolean, customers: Customer[], notes: Note[]): Map<string, MatchedNote[]> {
  const map = new Map<string, Array<Note & { viaName: string }>>();
  const customerByCode = new Map<string, Customer>();
  for (const c of customers) {
    if (c.scoularId) customerByCode.set(c.scoularId, c);
  }

  for (const n of notes) {
    if (!n.customerCode || !predicate(n)) continue;
    const owner = customerByCode.get(n.customerCode);
    // Consistent shape: always include the code in trailing parens. Name prepended when known,
    // omitted otherwise. Avoids the previous "Name (Code)" vs bare "Code" visual mismatch.
    const viaName = owner ? `${owner.name} (${owner.scoularId})` : `(${n.customerCode})`;
    const arr = map.get(n.customerCode);
    const tagged = { ...n, viaName };
    if (arr) arr.push(tagged);
    else map.set(n.customerCode, [tagged]);
  }

  for (const arr of map.values()) {
    arr.sort((a, b) => {
      if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
      const dt = parseNoteTime(b.createdAt) - parseNoteTime(a.createdAt);
      return dt !== 0 ? dt : (b.id ?? 0) - (a.id ?? 0);
    });
  }
  return map;
}

/** Per-customer aggregated matching notes (own + linked + incoming), pinned-first then newest-first. */
export function aggregateMatchingNotes(
  matchesByCode: Map<string, MatchedNote[]>,
  customers: Customer[],
  components: Map<string, Set<string>>,
): Map<number, MatchedNote[]> {
  const map = new Map<number, Array<Note & { viaName: string }>>();

  for (const customer of customers) {
    const ownCode = customer.scoularId;
    if (!ownCode) continue;
    // Walk the full connected component so chained links (A→B→C) aggregate every member's
    // notes onto the representative row.
    const codes = components.get(ownCode) ?? new Set([ownCode]);

    const out: Array<Note & { viaName: string }> = [];
    const seen = new Set<number>();
    for (const code of codes) {
      const matches = matchesByCode.get(code);
      if (!matches) continue;
      for (const n of matches) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        out.push(n);
      }
    }
    if (out.length === 0) continue;
    out.sort((a, b) => {
      if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
      const dt = parseNoteTime(b.createdAt) - parseNoteTime(a.createdAt);
      return dt !== 0 ? dt : (b.id ?? 0) - (a.id ?? 0);
    });
    map.set(customer.id, out);
  }
  return map;
}

/** Latest-contact time (ms since epoch) per customerId from the last-contact AGGREGATE, rolled up
 *  over each producer's linked-producer component. Absent = the producer and its entire linked
 *  chain have never been contacted. */
export function lastContactTimeByCustomer(
  noteLastContacts: NoteLastContact[],
  components: Map<string, Set<string>>,
  customers: Customer[],
): Map<number, number> {
  // Index latest-contact time by customerCode from the aggregate — correct on every prompt and
  // never dependent on a full-notes download.
  const notesByCode = new Map<string, number>();
  for (const lc of noteLastContacts) {
    if (!lc.customerCode) continue;
    const time = parseNoteTime(lc.lastNoteAt as unknown as string);
    const existing = notesByCode.get(lc.customerCode);
    if (existing == null || time > existing) notesByCode.set(lc.customerCode, time);
  }

  // Walk the full linked-producer connected component for each customer so the "last contacted"
  // time reflects the entire chain (A→B→C). Same closure used everywhere else linked behavior
  // matters, so this key, the badge, and the inline note panel all agree.
  const latest = new Map<number, number>();
  for (const customer of customers) {
    if (!customer.scoularId) continue;
    const codes = components.get(customer.scoularId) ?? new Set([customer.scoularId]);
    let latestTime = 0;
    for (const code of codes) {
      const t = notesByCode.get(code);
      if (t != null && t > latestTime) latestTime = t;
    }
    if (latestTime > 0) latest.set(customer.id, latestTime);
  }
  return latest;
}

/** The "Contacted N days ago" badge per customerId (green under a week, yellow under 30 days, red
 *  after), from the latest-contact times. Days are counted between local midnights. */
export function lastContactBadges(latestNotes: Map<number, number>): Map<number, { text: string; colorClass: string; daysAgo: number }> {
  const map = new Map<number, { text: string; colorClass: string; daysAgo: number }>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const [customerId, time] of latestNotes) {
    const noteDate = new Date(time);
    noteDate.setHours(0, 0, 0, 0);
    // Math.round (not floor): both endpoints are zeroed to local midnight, so the diff is an
    // integer number of days — except across DST transitions where the day is 23 or 25 hours.
    // round handles those edges; floor would mis-bucket a note from yesterday as "today" on
    // spring-forward day.
    const daysAgo = Math.max(0, Math.round((today.getTime() - noteDate.getTime()) / 86400000));
    let result: { text: string; colorClass: string; daysAgo: number };
    if (daysAgo === 0) result = { text: 'Contacted today', colorClass: 'text-scoular-green', daysAgo };
    else if (daysAgo === 1) result = { text: 'Contacted yesterday', colorClass: 'text-scoular-green', daysAgo };
    else if (daysAgo < 7) result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-scoular-green', daysAgo };
    else if (daysAgo < 30) result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-yellow-500', daysAgo };
    else result = { text: `Contacted ${daysAgo} days ago`, colorClass: 'text-scoular-red', daysAgo };
    map.set(customerId, result);
  }
  return map;
}

/** Bounded recency window (days) a positive date-scoped prompt/refine needs for DISPLAY, or null
 *  if it isn't a bounded positive-recency one. Padded +1 day so the fetch slice is always at
 *  least as wide as the display cutoff (never drops a shown note). */
export function recencyWindowDays(r: RefinementFilters, queryText: string): number | null {
  if (r.notesInLastDays != null && r.notesInLastDays > 0) return r.notesInLastDays + 1;
  const q = queryText.toLowerCase();
  const numeric = q.match(/(?:notes?\s+(?:added|made|entered|written|created|left)|contacted|called|reach(?:ed)?\s+out)\s*(?:in|within)?\s*(?:the\s+)?(?:last|past)?\s*(\d+)\s*days?/);
  if (numeric) return parseInt(numeric[1], 10) + 1;
  if (/\btoday\b/.test(q)) return 2;
  if (/\byesterday\b/.test(q)) return 3;
  if (/\b(?:this|last)\s+week\b/.test(q)) return 8;
  if (/\b(?:this|last)\s+month\b/.test(q)) return 32;
  return null;
}

/** The note load the CURRENT prompt needs. The matched SET and last-contact badge come from the
 *  aggregate regardless — this governs only the DISPLAY payload:
 *   - 'none'    : no note-focused criterion active.
 *   - 'scoped'  : a server-narrowed slice (recency window / content keywords / pinned / author),
 *                 fetched LOCAL-only; the client then matches exactly, so the set is unchanged.
 *   - 'batched' : huge "everyone with notes" / "not contacted" lists — the set comes from the
 *                 aggregate (instant) and note bodies load one RENDER BATCH at a time by
 *                 customerId, so the first screen never waits on the whole 28.8k-note set.
 *   - 'full'    : needs the whole set (note counts, "by someone else", or any unclassifiable combo).
 *
 * `gen` is the page's query generation (embedded in a scoped key so a new prompt never reuses a
 * slice); `deps` supplies the NLQ keyword extractor and the signed-in user's author candidates.
 */
export function noteScope(
  r: RefinementFilters,
  queryText: string,
  gen: number,
  deps: { searchKeywords: (queryText: string) => string[]; authorCandidates: () => string[] },
): NoteScope {
  if (!isNoteFilterActive(r, queryText)) return { mode: 'none' };
  const q = queryText.toLowerCase();
  // Note-COUNT prompts genuinely need every note (to count per producer).
  const count = !!r.contactedOnlyOnce || !!r.contactedMoreThan5 || /most\s+notes|most\s+engaged|by\s+notes/.test(q);
  if (count) return { mode: 'full' };
  // "contacted by someone else" = notes NOT by me — that's ~all notes, not a cheap server
  // superset, so it stays full.
  if (r.contactedBySomeoneElse) return { mode: 'full' };

  const absence = !!r.neverContacted || (r.notContactedDays != null && r.notContactedDays > 0)
    || /never\s+contacted|not\s+contacted|haven'?t\s+contacted|haven'?t\s+called/.test(q);
  const kws = new Set<string>();
  for (const k of deps.searchKeywords(queryText)) kws.add(k);
  const refineKw = r.noteKeyword?.trim().toLowerCase();
  if (refineKw) kws.add(refineKw);
  const contentActive = kws.size > 0;
  const pinnedActive = /pinned/.test(q) || !!r.hasPinnedNotes;
  // "Producers I have contacted" / "by me" / "my notes" — an author search on the CURRENT user.
  // The server authorAny filter (CreatedBy/ModifiedBy Contains candidate) is identical to the
  // client's matchesAuthor, so a scoped author fetch returns exactly the by-me notes — no need to
  // load all ~28.8k. Guarded by !absence so "I have NOT contacted…" still routes to batched.
  const byMe = !absence && (!!r.contactedByMeOnly
    || /\b(?:who\s+have\s+)?i\s+(?:have\s+)?(?:contacted|called|reached|noted)\b/.test(q)
    || /\bby\s+me\b/.test(q) || /\bmy\s+notes?\b/.test(q));
  // Absence phrasing ("not contacted in 30 days") trips the recency regex — ignore the window
  // for absence so it routes to 'batched', not a wrong positive-recency slice.
  const window = absence ? null : recencyWindowDays(r, queryText);

  // Absence: batched on its own; but mixed with a note-content/pinned criterion it needs the real
  // bodies → full (safe).
  if (absence) return (contentActive || pinnedActive) ? { mode: 'full' } : { mode: 'batched' };

  // Combine EVERY active scopable criterion (author / content / pinned / recency window) into ONE
  // server-narrowed slice — this is what keeps "Producers I contacted this week" (author + window)
  // fast instead of falling to a full load. Each server filter is a superset-or-equal of the
  // client's per-criterion match, so their AND still contains everything the client needs; the
  // client then re-matches exactly, so the result set is unchanged.
  const opts: NoteScopeOptions = {};
  const keyParts: string[] = [];
  if (byMe) {
    const cands = deps.authorCandidates();
    if (cands.length === 0) return { mode: 'full' }; // no identity to scope on — fall back
    const list = [...cands].sort();
    opts.authorAny = list; keyParts.push(`author:${list.join('|')}`);
  }
  if (contentActive) { const list = [...kws].sort(); opts.contentAny = list; keyParts.push(`content:${list.join('|')}`); }
  if (pinnedActive) { opts.pinnedOnly = true; keyParts.push('pinned'); }
  if (window != null) { opts.sinceDays = window; keyParts.push(`w:${window}`); }

  if (keyParts.length > 0) return { mode: 'scoped', key: `${gen}:${keyParts.join('+')}`, opts };

  // No scopable criterion — bare "producers with notes" (has-any-note), but NOT "with notes BY
  // <name>" (that's author) → batched; otherwise full.
  if (/(?:with|has|have)\s+notes?\b/.test(q) && !/\bby\b/.test(q)) return { mode: 'batched' };
  return { mode: 'full' };
}
