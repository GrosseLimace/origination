import { describe, it, expect, beforeEach } from 'vitest';
import { SecurityContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { HighlightPipe } from './highlight.pipe';

/**
 * This pipe is the app's ONLY bypassSecurityTrustHtml call, so it is the one place Angular's
 * built-in escaping is deliberately switched off. It is safe today because it escapes the text
 * FIRST and then inserts only its own static `<mark>` markup — but nothing pinned that, so a
 * future edit that reorders or drops the escape step would hand user-controlled HTML straight to
 * the DOM with no test failing. These pin the escaping specifically.
 */
describe('HighlightPipe', () => {
  let pipe: HighlightPipe;
  let sanitizer: DomSanitizer;

  /** bypassSecurityTrustHtml returns an opaque SafeHtml; unwrap it back to the string it will
   *  actually render as. */
  const render = (text: string | null | undefined, keyword: string | readonly string[] | null | undefined): string =>
    sanitizer.sanitize(SecurityContext.HTML, pipe.transform(text, keyword)) ?? '';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [HighlightPipe] });
    pipe = TestBed.inject(HighlightPipe);
    sanitizer = TestBed.inject(DomSanitizer);
  });

  // -------------------------------------------------------------------------
  // The escaping. This is the security-relevant part.
  // -------------------------------------------------------------------------

  it('escapes HTML in the text when there is no keyword', () => {
    const out = render('<script>alert(1)</script>', '');

    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes HTML in the text when a keyword DOES match', () => {
    // The dangerous path: highlighting is active, so the replace() runs over the escaped string.
    const out = render('<img src=x onerror=alert(1)> Jones Farm', 'Jones');

    expect(out).toContain('&lt;img');
    expect(out).toContain('<mark');   // and the highlight still happened

    // The precise property, rather than hunting for substrings: the ONLY tags in the output are
    // the pipe's own <mark> markup. "onerror=alert(1)" does survive as text, but with its angle
    // brackets escaped it's inert content, not an attribute — so asserting on that substring
    // would fail for a string that is actually safe.
    const tags = out.match(/<\/?[a-zA-Z][^>]*>/g) ?? [];
    expect(tags.every(t => /^<\/?mark/.test(t))).toBe(true);
  });

  it('does not let a keyword inject markup', () => {
    // A keyword is used to build a RegExp and nothing else; the replacement inserts $1 from the
    // already-escaped text, never the raw keyword.
    const out = render('hello world', '<b>');

    expect(out).not.toContain('<b>');
  });

  it('escapes quotes and ampersands', () => {
    const out = render(`Tom & "Jerry" O'Neill`, '');

    expect(out).toContain('&amp;');
    expect(out).toContain('&quot;');
    expect(out).toContain('&#39;');
  });

  // -------------------------------------------------------------------------
  // The highlighting behaviour itself.
  // -------------------------------------------------------------------------

  it('wraps a match in a mark element', () => {
    const out = render('Jones Farm', 'Jones');

    expect(out).toMatch(/<mark[^>]*>Jones<\/mark>/);
    expect(out).toContain('Farm');
  });

  it('matches case-insensitively and preserves the original casing', () => {
    const out = render('Jones Farm', 'jones');

    expect(out).toMatch(/<mark[^>]*>Jones<\/mark>/);
  });

  it('highlights every occurrence', () => {
    const out = render('corn corn corn', 'corn');

    expect(out.match(/<mark/g)).toHaveLength(3);
  });

  it('treats regex metacharacters in the keyword literally', () => {
    // Without _escapeRegex, '.' would match any character and '(' would throw.
    expect(() => render('a.b acb', '.')).not.toThrow();
    const dot = render('a.b acb', '.');
    expect(dot.match(/<mark/g)).toHaveLength(1);   // only the literal dot, not the 'c'

    expect(() => render('cost (net)', '(net)')).not.toThrow();
    expect(render('cost (net)', '(net)')).toContain('<mark');
  });

  it('leaves the text alone when the keyword is absent, blank or whitespace', () => {
    for (const kw of ['', '   ', null, undefined]) {
      expect(render('Jones Farm', kw)).not.toContain('<mark');
    }
  });

  it('handles null and undefined text', () => {
    expect(render(null, 'x')).toBe('');
    expect(render(undefined, 'x')).toBe('');
  });

  it('returns the text unchanged when the keyword does not appear', () => {
    const out = render('Jones Farm', 'Smith');

    expect(out).not.toContain('<mark');
    expect(out).toContain('Jones Farm');
  });

  // -------------------------------------------------------------------------
  // Several words (a producer's bin site names, 2026-10-09).

  it('marks every word in a list, longest first', () => {
    const out = render('North Bins full; Home Place empty; north side ok', ['North', 'North Bins', 'Home Place']);
    expect(out).toContain('<mark class="bg-yellow-200 dark:bg-yellow-700/60 text-gray-900 dark:text-white rounded px-0.5">North Bins</mark>');
    expect(out).toContain('>Home Place</mark>');
    expect(out).toContain('>north</mark> side');
  });

  it('still escapes the text when highlighting a list, and treats each word literally', () => {
    const out = render('<img src=x onerror=alert(1)> Bins (East) & A+B', ['Bins (East)', 'A+B', '&']);
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
    expect(out).toContain('>Bins (East)</mark>');
    expect(out).toContain('>A+B</mark>');
    expect(out).toContain('>&amp;</mark>');
  });

  it('highlights nothing for an empty list', () => {
    expect(render('North Bins', [])).not.toContain('<mark');
  });
});
