import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every CI the field plan shows is a planning estimate until the field is reviewed with the producer and its
 * CTRM tickets after harvest and confirmed; only that confirmed CI is the official result. So no screen may
 * call a result "final" or "finalized" (CTRM's ticket status "Final Settled" is CTRM's wording, not ours), and
 * "official" only appears as the status line or to say an estimate isn't one yet. A file-content check is
 * blunt, but it fails loudly when the wording drifts back, which is the regression that matters.
 */
describe('field plan wording: estimates until confirmed, never final', () => {
  const dir = join(process.cwd(), 'src', 'app', 'features', 'customers', 'components', 'field-plan');
  const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e: { name: string; isDirectory(): boolean }) =>
    e.isDirectory() ? files(join(d, e.name)) : /\.(html|ts)$/.test(e.name) && !e.name.endsWith('.spec.ts') ? [join(d, e.name)] : []);
  const sources = files(dir).map(f => ({ f, text: readFileSync(f, 'utf8') }));

  it('should never call a result final or finalized', () => {
    for (const { f, text } of sources) expect(text.replace(/Final Settled/g, ''), f).not.toMatch(/\bfinal(i[sz](e|ed|es|ing))?\b/i);
  });

  it('should only mention an official result as a status, or as what an estimate isn\'t yet', () => {
    // Markup lines (in .html files and inline templates) that mention "official".
    const markup = sources
      .filter(({ f, text }) => f.endsWith('.html') || text.includes('template: `'))
      .flatMap(({ f, text }) => text.split('\n').filter((l: string) => /official/i.test(l) && /<|\{\{|@if/.test(l)).map((line: string) => ({ f, line })));
    expect(markup.length).toBeGreaterThan(0);
    for (const { f, line } of markup) {
      // The words shown, with tags, bindings and control flow removed; each "official" in them must be
      // the status placeholder ("Official {name}: {status}"), "Not an official {name}" or a column heading.
      const shown = line.replace(/@if \([^)]*\)/g, '').replace(/\{\{[^}]*\}\}/g, '{}').replace(/<[^>]*>/g, ' ');
      for (const m of shown.matchAll(/(\w+\s+)?official(\s+\S+)?/gi)) {
        expect(m[0].replace(/\s+/g, ' ').trim(), `${f}: ${line.trim()}`).toMatch(/^(Official \{\}:|Not an official|an official \{\}(\.\}?)?|Official \}|Official)$/);
      }
    }
  });
});
