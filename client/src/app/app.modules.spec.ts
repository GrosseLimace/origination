import { describe, it, expect } from 'vitest';
import { appModules } from './app.modules';
import { routes } from './app.routes';

describe("the app's pages and links", () => {
  const pages = appModules.flatMap(module => module.routes ?? []);

  it('gate each page by the reads its own screen makes, as its API calls do', () => {
    expect(Object.fromEntries(pages.map(page => [page.path, page.requires]))).toEqual({
      '': [],
      dashboard: ['planting-estimates:read'],
      'build-list': ['query-library:read', 'saved-lists:read:own'],
      insights: ['customers:read', 'contracts:read', 'tickets:read'],
      'bid-sheet': ['bid-sheets:read'],
      'daily-digest': ['recap-groups:read'],
      'usage-dashboard': ['usage-reports:read'],
      'usage-dashboard/users/:userId': ['usage-reports:read'],
      'whats-new': [],
      help: [],
    });
  });

  it('show each link only to users who may open its page', () => {
    const required = new Map(pages.map(page => ['/' + page.path, page.requires]));

    for (const link of appModules.flatMap(module => module.nav ?? [])) {
      expect(required.get(link.path), link.path).toEqual(link.requires);
    }
  });

  it('list each module once, and send every other path home', () => {
    const ids = appModules.map(module => module.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(routes.at(-1)).toEqual({ path: '**', redirectTo: '' });
  });
});
