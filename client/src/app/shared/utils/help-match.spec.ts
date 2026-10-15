import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HelpContent, HelpFaq } from '@models';
import { filterHelpFaqs, matchHelpQuestion, questionWords } from './help-match';

function faq(id: string, question: string, keywords: string[] = [], routes: string[] = [], answer = 'An answer.'): HelpFaq {
  return { id, question, keywords, routes, answer, feature: 'system', related: [], uiLabels: [], lastVerified: '2026-10-13' };
}

const fixture: HelpFaq[] = [
  faq('missing-producer', "A producer isn't showing up in my list", ['missing', 'find', 'showing']),
  faq('build-list', 'How do I build a list?', ['build', 'query', 'save'], ['/build-list']),
  faq('season-targets', 'How do I set season targets?', ['season', 'targets', 'yield'], ['/dashboard']),
  faq('tu-a', 'What is a trade unit?', ['trade', 'unit']),
  faq('tu-b', 'How do I set up my trade units?', ['trade', 'unit'])
];

describe('questionWords', () => {
  it('drops stop words and very short words', () => {
    expect(questionWords('How do I build a list?')).toEqual(['build', 'list']);
  });

  it('reads "can\'t" as "cant" and maps it to "missing"', () => {
    expect(questionWords("can't find")).toContain('missing');
  });

  it('expands the "TU" abbreviation even though it is only two letters', () => {
    expect(questionWords('TU')).toEqual(['trade', 'unit']);
  });

  it('folds simple plurals', () => {
    expect(questionWords('producers')).toEqual(['producer']);
  });
});

describe('matchHelpQuestion', () => {
  it('answers a clear match', () => {
    expect(matchHelpQuestion('how do I build a list', fixture)).toEqual({ kind: 'answer', id: 'build-list' });
  });

  it('matches through a synonym — "customer" means producer', () => {
    expect(matchHelpQuestion('customer not showing', fixture)).toEqual({ kind: 'answer', id: 'missing-producer' });
  });

  it('matches the start of a longer word', () => {
    expect(matchHelpQuestion('target yield', fixture)).toEqual({ kind: 'answer', id: 'season-targets' });
  });

  it('offers "did you mean" instead of guessing when the top questions tie', () => {
    expect(matchHelpQuestion('TU', fixture)).toEqual({ kind: 'did-you-mean', ids: ['tu-a', 'tu-b'] });
  });

  it('breaks a tie in favour of the screen the user is on', () => {
    const tied = [faq('a', 'Saved list question', ['saved']), faq('b', 'Saved list other', ['saved'], ['/build-list'])];
    expect(matchHelpQuestion('saved', tied, '/build-list')).toEqual({ kind: 'answer', id: 'b' });
  });

  it('returns no match for gibberish', () => {
    expect(matchHelpQuestion('qwzx plorb', fixture)).toEqual({ kind: 'no-match' });
  });

  it('returns no match when fewer than half the words land', () => {
    expect(matchHelpQuestion('build harvest freight weather', fixture)).toEqual({ kind: 'no-match' });
  });

  it('returns no match for a question made only of stop words', () => {
    expect(matchHelpQuestion('how do I', fixture)).toEqual({ kind: 'no-match' });
  });
});

describe('filterHelpFaqs', () => {
  it('keeps only questions containing every word', () => {
    expect(filterHelpFaqs('season yield', fixture).map(f => f.id)).toEqual(['season-targets']);
  });

  it('returns nothing for an empty query', () => {
    expect(filterHelpFaqs('  ', fixture)).toEqual([]);
  });
});

/**
 * The questions users actually ask, against the real content file. These guard the CONTENT as much as
 * the matcher: if an edit to help-faq.json stops "customer not showing" finding the missing-producer
 * answer, this fails before users notice.
 */
describe('matchHelpQuestion against the shipped content', () => {
  const content = JSON.parse(
    readFileSync(join(process.cwd(), '../api/GrainOriginatorPortal.Api/Content/help-faq.json'), 'utf-8')
  ) as HelpContent;
  const answer = (q: string, route: string | null = null) => matchHelpQuestion(q, content.faqs, route);

  it.each([
    ['customer not showing', 'missing-producer'],
    ["I can't find a producer", 'missing-producer'],
    ['how do I build a list', 'build-list'],
    ['set season targets', 'season-targets'],
    ['what is an unapplied ticket', 'unapplied-ticket'],
    ['create a group', 'create-group'],
    ['add a note', 'add-note'],
    ['report a bug', 'report-problem'],
    ['contracts could not be loaded', 'contracts-not-loaded'],
    ['saved list not in dropdown', 'saved-list-missing'],
    ['how do I link producers', 'link-producers'],
    ['bin site rejected outside north america', 'bin-site-outside-north-america'],
    ['how do I mention someone in a note', 'mention-someone'],
    ['can I save a calculation', 'calculator-save'],
    ['what are DP contracts', 'dp-contracts'],
    ['print a producer report', 'print-producer-report']
  ])('"%s" answers with %s', (question, expected) => {
    expect(answer(question)).toEqual({ kind: 'answer', id: expected });
  });

  it('gives up on a question the content does not cover', () => {
    expect(answer('what is the weather in Omaha')).toEqual({ kind: 'no-match' });
  });
});
