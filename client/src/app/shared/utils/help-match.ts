import type { HelpFaq } from '@models';

/** What the panel should show for a typed question. */
export type HelpMatch =
  | { kind: 'answer'; id: string }
  | { kind: 'did-you-mean'; ids: string[] }
  | { kind: 'no-match' };

/** Words that carry no meaning in a help question. */
const STOP_WORDS = new Set([
  'the', 'and', 'how', 'what', 'why', 'does', 'can', 'for', 'are', 'not', 'with', 'this', 'that',
  'you', 'your', 'isnt', 'its', 'mean', 'get', 'when', 'where', 'there', 'from', 'have', 'has',
  'into', 'out', 'way', 'need', 'want', 'should', 'would', 'could', 'just', 'any', 'all', 'some',
  'about', 'than', 'then', 'them', 'they', 'was', 'were', 'will', 'did', 'didnt', 'dont', 'doesnt',
  'see', 'use', 'using', 'help', 'please', 'there', 'here'
]);

/**
 * What users type, mapped to the words the content uses. Applied before the short-word filter, so
 * two-letter abbreviations like "tu" still count.
 */
const SYNONYMS: Record<string, string[]> = {
  tu: ['trade', 'unit'],
  tus: ['trade', 'unit'],
  dp: ['delayed', 'pricing'],
  nop: ['nop', 'organic'],
  customer: ['producer'],
  grower: ['producer'],
  farmer: ['producer'],
  farm: ['producer'],
  account: ['producer'],
  cant: ['missing'],
  gone: ['missing'],
  disappeared: ['missing'],
  bug: ['problem'],
  broken: ['problem'],
  issue: ['problem'],
  servicenow: ['report'],
  recaps: ['recap'],
  reminder: ['follow'],
  followup: ['follow'],
  intention: ['planting'],
  intentions: ['planting']
};

const MIN_WORD = 3;
/** Shortest query word allowed to match the start of a longer word ("plant" → "planting"). */
const MIN_PREFIX = 4;
/** Share of the question's words that must match before an answer is offered. */
const MIN_COVERAGE = 0.5;

/** Lower-cases, drops apostrophes so "can't" reads as "cant", and splits on everything else. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

/** A light plural fold, so "producers" and "producer" are the same word. */
function stem(word: string): string {
  return word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/** The meaningful words of a question, synonyms expanded, each once. */
export function questionWords(question: string): string[] {
  const words = new Set<string>();
  for (const token of tokenize(question)) {
    for (const word of [token, ...(SYNONYMS[token] ?? [])]) {
      if (word.length >= MIN_WORD && !STOP_WORDS.has(word)) words.add(stem(word));
    }
  }
  return [...words];
}

/** Each searchable field of a question with its weight: keywords count most, the answer least. */
function weightedFields(faq: HelpFaq): { words: string[]; weight: number }[] {
  return [
    { words: faq.keywords.flatMap(tokenize).map(stem), weight: 3 },
    { words: tokenize(faq.question + ' ' + (faq.chip ?? '')).map(stem), weight: 2 },
    { words: tokenize(faq.answer).map(stem), weight: 1 }
  ];
}

function wordMatches(queryWord: string, candidate: string): boolean {
  return candidate === queryWord || (queryWord.length >= MIN_PREFIX && candidate.startsWith(queryWord));
}

interface Scored {
  id: string;
  score: number;
  coverage: number;
}

function score(faq: HelpFaq, words: string[], route: string | null): Scored {
  const fields = weightedFields(faq);
  let total = 0;
  let matched = 0;
  for (const word of words) {
    // A word found in the keywords AND the question AND the answer is stronger evidence than one
    // found in a single place, so the weights add up across fields.
    const weight = fields.filter(f => f.words.some(c => wordMatches(word, c))).reduce((sum, f) => sum + f.weight, 0);
    if (weight > 0) {
      total += weight;
      matched++;
    }
  }
  // A question about the screen the user is on wins a tie against one that isn't.
  if (matched > 0 && route !== null && faq.routes.includes(route)) total += 1;
  return { id: faq.id, score: total, coverage: matched / words.length };
}

/**
 * Picks the answer for a typed question. Pure, so the panel, the Help page and the tests all agree.
 *
 * - No meaningful words, or no question matching at least half of them: no match.
 * - A clear winner: that answer.
 * - A tie at the top: "Did you mean…" with up to three options, rather than guessing.
 */
export function matchHelpQuestion(question: string, faqs: readonly HelpFaq[], route: string | null = null): HelpMatch {
  const words = questionWords(question);
  if (words.length === 0) return { kind: 'no-match' };

  const ranked = faqs
    .map(faq => score(faq, words, route))
    .filter(s => s.score > 0 && s.coverage >= MIN_COVERAGE)
    .sort((a, b) => b.score - a.score || b.coverage - a.coverage);

  if (ranked.length === 0) return { kind: 'no-match' };

  const [top, next] = ranked;
  if (next && next.score === top.score && next.coverage === top.coverage) {
    return { kind: 'did-you-mean', ids: ranked.slice(0, 3).map(s => s.id) };
  }
  return { kind: 'answer', id: top.id };
}

/**
 * Filters questions for the Help page search box: every typed word must appear somewhere in the
 * question, its keywords or its answer. Stricter than matchHelpQuestion on purpose — it narrows a
 * list the user can see, rather than choosing one answer for them.
 */
export function filterHelpFaqs(query: string, faqs: readonly HelpFaq[]): HelpFaq[] {
  const words = questionWords(query);
  if (words.length === 0) return [];
  return faqs.filter(faq => {
    const haystack = weightedFields(faq).flatMap(f => f.words);
    return words.every(word => haystack.some(candidate => wordMatches(word, candidate)));
  });
}
