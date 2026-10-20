import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { HelpAction, HelpContent } from '@models';
import { HELP_ANCHOR_TIPS } from '@shared/components/help-panel/help-spotlight.component';
import { HELP_TROUBLESHOOTERS } from '@shared/components/help-panel/help-troubleshooter.component';

/**
 * Keeps the help content in step with the app.
 *
 * Help that describes a button by a name it no longer has is worse than no help, and nothing else
 * would notice: the content is a JSON file the compiler never sees. So this reads the shipped
 * help-faq.json and the Angular source side by side and fails when they disagree — renaming a
 * button, removing a route or dropping a data-help-anchor breaks the build until the help is
 * updated in the same change. (The API's HelpControllerTests cover the file's internal consistency.)
 */

const clientRoot = process.cwd();
const appRoot = join(clientRoot, 'src', 'app');
const content = JSON.parse(
  readFileSync(join(clientRoot, '../api/GrainOriginatorPortal.Api/Content/help-faq.json'), 'utf-8')
) as HelpContent;

/** Help's own files are excluded, so the help can't vouch for itself. */
const HELP_OWN = [join('features', 'help') + sep, join('shared', 'components', 'help-panel') + sep, join('models', 'help.model.ts')];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(html|ts)$/.test(name) && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

const appSource = sourceFiles(appRoot)
  .filter(path => !HELP_OWN.some(own => relative(appRoot, path).startsWith(own)))
  .map(path => readFileSync(path, 'utf-8'))
  .join('\n')
  // Templates escape "&" as "&amp;"; the help names labels as users read them.
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

/** Every route path declared in app.routes.ts, as "/", "/build-list", … */
const declaredRoutes = new Set(
  [...readFileSync(join(appRoot, 'app.routes.ts'), 'utf-8').matchAll(/path:\s*'([^']*)'/g)]
    .map(m => m[1])
    .filter(path => path !== '**')
    .map(path => '/' + path)
);

/** Routes users don't need screen-specific suggestions for: admin, release notes and help itself.
 *  They fall back to the "*" list. */
const NO_SUGGESTIONS_NEEDED = ['/usage-dashboard', '/usage-dashboard/users/:userId', '/whats-new', '/help'];

const allActions: { faqId: string; action: HelpAction }[] = content.faqs.flatMap(f =>
  [...(f.actions ?? []), ...(f.link ? [f.link] : [])].map(action => ({ faqId: f.id, action }))
);

describe('help-faq.json against the app', () => {
  it('only names routes that exist', () => {
    const named = [
      ...content.faqs.flatMap(f => f.routes.map(route => ({ where: `${f.id}.routes`, route }))),
      ...Object.keys(content.suggestions).filter(k => k !== '*').map(route => ({ where: 'suggestions', route })),
      ...allActions.filter(a => a.action.kind === 'route').map(a => ({ where: `${a.faqId} action`, route: a.action.target!.split(/[?#]/)[0] }))
    ];
    const missing = named.filter(n => !declaredRoutes.has(n.route)).map(n => `${n.where}: ${n.route}`);
    expect(missing, 'Routes named in help-faq.json that app.routes.ts no longer declares').toEqual([]);
  });

  it('suggests questions for every screen users work in', () => {
    const uncovered = [...declaredRoutes].filter(r => !NO_SUGGESTIONS_NEEDED.includes(r) && !content.suggestions[r]);
    expect(uncovered, 'New screens need a "suggestions" entry in help-faq.json').toEqual([]);
  });

  it('only names on-screen labels that still appear in the app', () => {
    const missing = content.faqs.flatMap(f =>
      f.uiLabels.filter(label => !appSource.includes(label.replace(/\s+/g, ' '))).map(label => `${f.id}: "${label}"`)
    );
    expect(missing, 'Labels in help-faq.json uiLabels that no longer appear in any template — update the help to match').toEqual([]);
  });

  it('only spotlights anchors that exist in the app and have a tooltip', () => {
    const anchors = allActions.filter(a => a.action.kind === 'spotlight').map(a => ({ faqId: a.faqId, anchor: a.action.target! }));
    const notInApp = anchors.filter(a => !hasAnchor(a.anchor)).map(a => `${a.faqId}: ${a.anchor}`);
    const noTip = anchors.filter(a => !HELP_ANCHOR_TIPS[a.anchor]).map(a => `${a.faqId}: ${a.anchor}`);
    expect(notInApp, 'Spotlight targets with no data-help-anchor in the app').toEqual([]);
    expect(noTip, 'Spotlight targets with no tooltip in HELP_ANCHOR_TIPS').toEqual([]);
  });

  it('every tooltip belongs to an anchor that still exists', () => {
    const orphaned = Object.keys(HELP_ANCHOR_TIPS).filter(anchor => !hasAnchor(anchor));
    expect(orphaned, 'HELP_ANCHOR_TIPS entries whose data-help-anchor was removed from the app').toEqual([]);
  });

  it('only starts troubleshooters that exist', () => {
    const unknown = content.faqs.flatMap(f => (f.troubleshoot ?? []).filter(t => t.tree && !(HELP_TROUBLESHOOTERS as readonly string[]).includes(t.tree)).map(t => `${f.id}: ${t.tree}`));
    expect(unknown).toEqual([]);
  });

  it('flags answers nobody has checked in six months (warning only)', () => {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const stale = content.faqs.filter(f => new Date(f.lastVerified) < sixMonthsAgo).map(f => f.id);
    if (stale.length) console.warn(`Help answers not re-checked in 6+ months: ${stale.join(', ')}`);
    expect(true).toBe(true);
  });
});

function hasAnchor(anchor: string): boolean {
  return appSource.includes(`data-help-anchor="${anchor}"`) || appSource.includes(`'data-help-anchor': '${anchor}'`);
}
