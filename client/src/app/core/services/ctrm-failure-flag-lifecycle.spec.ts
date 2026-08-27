import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { of, throwError, firstValueFrom, lastValueFrom } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { TestBed } from '@angular/core/testing';
import { AppStateService } from '@core/services/app-state.service';

/**
 * WHEN the failure flags are set and cleared - the half that a "does the signal work" test cannot see.
 *
 * The first version of this cleared the flag inside setContracts/setTickets, which looked tidier and was
 * wrong: every failure path resolves to an empty array that flows through those same setters one operator
 * later, so the flag was set by catchError and cleared in the same tick. The banner could never appear,
 * and the existing spec passed throughout because it only ever set the signal directly.
 */
describe('CTRM failure flags — lifecycle', () => {
  const src = (...parts: string[]) => readFileSync(join(process.cwd(), 'src', 'app', ...parts), 'utf8');

  describe('the pipe pattern itself', () => {
    let appState: AppStateService;

    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [AppStateService] });
      appState = TestBed.inject(AppStateService);
    });

    it('leaves the flag SET when the read fails, even though the fallback flows on', async () => {
      appState.setContractsLoadFailed(false);

      const result = await lastValueFrom(
        throwError(() => new Error('gateway timeout')).pipe(
          tap(() => appState.setContractsLoadFailed(false)),
          catchError(() => { appState.setContractsLoadFailed(true); return of([] as unknown[]); })
        )
      );

      expect(result).toEqual([]);
      expect(appState.contractsLoadFailed()).toBe(true);
    });

    it('clears the flag when the read genuinely succeeds', async () => {
      appState.setContractsLoadFailed(true);

      await firstValueFrom(
        of([{ id: 1 }]).pipe(
          tap(() => appState.setContractsLoadFailed(false)),
          catchError(() => { appState.setContractsLoadFailed(true); return of([] as unknown[]); })
        )
      );

      expect(appState.contractsLoadFailed()).toBe(false);
    });

    it('clears the flag on a genuinely EMPTY success, which is not a failure', async () => {
      // A trade unit whose producers really have no contracts must not show the outage banner.
      appState.setContractsLoadFailed(true);

      await firstValueFrom(
        of([]).pipe(
          tap(() => appState.setContractsLoadFailed(false)),
          catchError(() => { appState.setContractsLoadFailed(true); return of([]); })
        )
      );

      expect(appState.contractsLoadFailed()).toBe(false);
    });
  });

  /**
   * The behaviour above only holds if the clearing sits AHEAD of the catchError at each real call site,
   * and nowhere else. These pin that arrangement, which is the thing that regressed.
   */
  describe('every trade-unit-wide call site uses that arrangement', () => {
    const sites: [string, string[], RegExp][] = [
      ['data-preload contracts', ['core', 'services', 'data-preload.service.ts'], /setContractsLoadFailed/],
      ['data-preload tickets', ['core', 'services', 'data-preload.service.ts'], /setTicketsLoadFailed/],
      ['build-list', ['features', 'build-list', 'pages', 'build-list', 'build-list.component.ts'], /setContractsLoadFailed/],
      ['customer-list', ['features', 'customers', 'components', 'customer-list', 'customer-list.component.ts'], /setContractsLoadFailed/],
    ];

    it.each(sites)('%s clears before it catches', (_name, parts, flag) => {
      const text = src(...parts);
      const clearMarker = flag.source + '(false)';
      const setMarker = flag.source + '(true)';

      const firstClear = text.indexOf(clearMarker);
      const firstSet = text.indexOf(setMarker);

      expect(firstClear, `${clearMarker} is missing - a successful read never clears the flag`).toBeGreaterThan(-1);
      expect(firstSet, `${setMarker} is missing - a failed read never sets the flag`).toBeGreaterThan(-1);

      // Ahead of the catchError, which is what makes it fire only on a real emission.
      expect(firstClear).toBeLessThan(firstSet);

      // ...and inside a tap, not in the setter or the catchError.
      const preceding = text.slice(Math.max(0, firstClear - 80), firstClear);
      expect(preceding, `${clearMarker} is not inside a tap()`).toContain('tap(');
    });

    it('no setter clears the flags, because the fallback flows through them', () => {
      const text = src('core', 'services', 'app-state.service.ts');

      for (const setter of ['setContracts(', 'setTickets(', 'setTodaysTickets(']) {
        const at = text.indexOf(setter + 'contracts: Contract[]') >= 0
          ? text.indexOf(setter + 'contracts: Contract[]')
          : text.indexOf(setter + 'tickets: Ticket[]');
        expect(at).toBeGreaterThan(-1);

        // The setter body, up to its closing brace.
        const body = text.slice(at, text.indexOf('\n  }', at));
        expect(body).not.toMatch(/LoadFailed\.set\(false\)/);
      }
    });
  });

  /**
   * Scope: the shared flag drives Build-a-List's banner. A producer's pacing history or the dashboard's
   * own crop-year read failing says nothing about that list, so those must stay local.
   */
  describe('producer-scoped and dashboard-scoped failures stay out of the shared flag', () => {
    it('the pacing card flags locally', () => {
      const text = src('features', 'customers', 'components', 'contract-pacing-card', 'contract-pacing-card.component.ts');

      expect(text).toMatch(/historyLoadFailed\.set\(true\)/);
      expect(text).not.toMatch(/setContractsLoadFailed\(true\)/);
    });

    it('the dashboard crop-year read flags locally', () => {
      const text = src('features', 'dashboard', 'pages', 'dashboard', 'dashboard.component.ts');

      expect(text).toMatch(/cropYearLoadFailed\.set\(true\)/);
      expect(text).not.toMatch(/setContractsLoadFailed\(true\)/);
    });

    it('the profile pacing read flags locally', () => {
      const text = src('features', 'customers', 'components', 'customer-profile', 'customer-profile.component.ts');

      expect(text).toMatch(/historicalContractsFailed\.set\(true\)/);
      expect(text).not.toMatch(/setContractsLoadFailed\(true\)/);
    });
  });
});
