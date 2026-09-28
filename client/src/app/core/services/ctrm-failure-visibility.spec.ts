import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { AppStateService } from '@core/services/app-state.service';

/**
 * A failed CTRM read must never reach the user as an empty list.
 *
 * The repositories return `[]` on failure by design (no silent ODS fallback), so "this producer has no
 * contracts" and "we could not reach CTRM" are the same shape in the data. Twice during development a
 * gateway timeout rendered as "no producers found" and was mistaken for an empty trade unit. At harvest
 * the same bug shows a grower's deliveries as zero, so the paths that distinguish the two are pinned here.
 */
describe('CTRM failure visibility', () => {
  describe('AppStateService — the trade-unit failure flags', () => {
    let appState: AppStateService;

    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [AppStateService] });
      appState = TestBed.inject(AppStateService);
    });

    it('starts clean, so a fresh session never claims a failure', () => {
      expect(appState.contractsLoadFailed()).toBe(false);
      expect(appState.ticketsLoadFailed()).toBe(false);
    });

    it('records a contract-read failure independently of the ticket read', () => {
      appState.contractsLoadFailed.set(true);

      expect(appState.contractsLoadFailed()).toBe(true);
      expect(appState.ticketsLoadFailed()).toBe(false);
    });
  });

  /**
   * The empty states are in templates the vitest setup deliberately strips (happy-dom + JIT cannot fetch
   * templateUrl), so these assert the templates' STRUCTURE instead: every empty state that could be
   * mistaken for a failure has to be guarded. A file-content check is blunt, but it fails loudly if the
   * guard is deleted, which is the regression that matters.
   */
  describe('empty states are guarded against being mistaken for failures', () => {
    const read = (...parts: string[]) => readFileSync(join(process.cwd(), 'src', 'app', ...parts), 'utf8');

    it('contracts-table shows the error branch before "No contracts found"', () => {
      const html = read('features', 'customers', 'components', 'contracts-table', 'contracts-table.component.html');
      const errorAt = html.indexOf('loadError()');
      const emptyAt = html.indexOf('No contracts found for this producer');

      expect(errorAt).toBeGreaterThan(-1);
      expect(emptyAt).toBeGreaterThan(-1);
      expect(errorAt).toBeLessThan(emptyAt);
    });

    it('tickets-table shows the error branch before "No unapplied delivery tickets"', () => {
      const html = read('features', 'customers', 'components', 'tickets-table', 'tickets-table.component.html');
      const errorAt = html.indexOf('loadError()');
      const emptyAt = html.indexOf('No unapplied delivery tickets found for this producer');

      expect(errorAt).toBeGreaterThan(-1);
      expect(emptyAt).toBeGreaterThan(-1);
      expect(errorAt).toBeLessThan(emptyAt);
    });

    it('build-list guards both "no producers" states with sourceLoadFailed', () => {
      const html = read('features', 'build-list', 'pages', 'build-list', 'build-list.component.html');

      // Both the trade-unit empty state and the query-result empty state.
      expect(html.split('sourceLoadFailed()').length - 1).toBeGreaterThanOrEqual(2);

      // The plain wording must sit inside a guard, never on its own.
      const plain = 'No producers found for the selected trade units';
      const guardBefore = html.lastIndexOf('sourceLoadFailed()', html.indexOf(plain));
      expect(guardBefore).toBeGreaterThan(-1);
    });
  });

  /**
   * The client only knows a read failed if the API says so. These pin the contract the server side of
   * this now honours: 503 + INFRASTRUCTURE_CTRM_UNAVAILABLE rather than 200 with an empty array.
   */
  describe('api.service — contract and ticket reads rethrow instead of swallowing', () => {
    it('no contract or ticket read resolves a failure to an empty array', () => {
      const src = readFileSync(join(process.cwd(), 'src', 'app', 'core', 'services', 'api.service.ts'), 'utf8');

      // Isolate the contract + ticket section and check none of its calls swallow to of([]).
      const from = src.indexOf('// Contract Operations');
      const to = src.indexOf('getUnappliedTicketsByCustomer');
      expect(from).toBeGreaterThan(-1);
      expect(to).toBeGreaterThan(from);

      const section = src.slice(from, to);
      const swallowed = section.match(/catchError\(\(\) => of\(\[\] as (Contract|Ticket)\[\]\)\)/g) ?? [];
      expect(swallowed).toEqual([]);
    });
  });
});
