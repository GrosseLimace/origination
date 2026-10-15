import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Import boundaries between the two Angular apps (plan §5.3). Enforced as a test because the
 * repo has no ESLint configuration.
 *  - the desktop app never imports the mobile app;
 *  - the mobile app only reaches the desktop through the shared-lib aliases (@libs/models,
 *    @libs/utils), never through @core/@shared/@features or a relative path into src/app.
 *  - the mobile app never talks HTTP outside MobileApiService (the contract is the allow-list).
 */
const clientRoot = resolve(__dirname, '../../../..');
const desktopApp = join(clientRoot, 'src', 'app');
const mobileApp = join(clientRoot, 'projects', 'mobile', 'src', 'app');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/from\s+['"]([^'"]+)['"]/g), ...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!);
}

describe('app boundaries', () => {
  it('desktop app does not import the mobile app', () => {
    const offenders = tsFiles(desktopApp).filter((f) => importsOf(f).some((i) => i.startsWith('@mobile') || i.includes('projects/mobile')));
    expect(offenders).toEqual([]);
  });

  it('mobile app reaches the desktop only through @libs aliases', () => {
    const offenders = tsFiles(mobileApp)
      .filter((f) => !f.endsWith('.spec.ts'))
      .flatMap((f) => importsOf(f).filter((i) => /^@(core|shared|features|models|env|testing)(\/|$)/.test(i) || /\.\.\/.*\bsrc\/app\b/.test(i)).map((i) => `${f} -> ${i}`));
    expect(offenders).toEqual([]);
  });

  it('only MobileApiService uses HttpClient', () => {
    const offenders = tsFiles(mobileApp)
      .filter((f) => !f.endsWith('.spec.ts') && !f.endsWith('mobile-api.service.ts'))
      .filter((f) => /\bHttpClient\b/.test(readFileSync(f, 'utf8')) && !/\bHttpErrorResponse\b/.test(readFileSync(f, 'utf8').replace(/HttpClient/g, '')))
      .filter((f) => /inject\(HttpClient\)|private readonly http\b/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
