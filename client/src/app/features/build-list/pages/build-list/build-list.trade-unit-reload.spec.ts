import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { Observable, Subject, of } from 'rxjs';
import { BuildListComponent } from './build-list.component';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { DataPreloadService } from '@core/services/data-preload.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { UserRolesService } from '@core/services/user-roles.service';
import { Customer, QueryLibraryItem, SavedList } from '@models';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A trade-unit change reloads every dataset for the new selection. Until 2026-10-12 the prompt
 * library was DISABLED for the whole reload (six requests, one of them producer details for every
 * producer in the system), with nothing on screen saying why - so the page read as frozen, and
 * leaving for the producer home page and coming back "fixed" it because the remount path takes
 * a cached shortcut the in-place path never had.
 *
 * These pin the replacement behaviour: the library stays clickable, a prompt picked mid-reload
 * is parked and runs once the fresh data lands, and a second change drops the first reload.
 */

/** Every API call the component makes at construction and on a trade-unit change. The core
 *  loads are driven by Subjects so a test controls WHEN each batch lands; everything else
 *  resolves empty immediately. */
class ApiStub {
  readonly batches: { customers: Subject<Customer[]>; tickets: Subject<unknown[]> }[] = [];

  getCustomers(): Observable<Customer[]> {
    const batch = { customers: new Subject<Customer[]>(), tickets: new Subject<unknown[]>() };
    this.batches.push(batch);
    return batch.customers.asObservable();
  }
  getTickets(): Observable<unknown[]> {
    return this.batches[this.batches.length - 1].tickets.asObservable();
  }
  getContracts() { return of([]); }
  getPlantingIntentions() { return of([]); }
  getStoredGrain() { return of([]); }
  getSavedLists() { return of([]); }
  getAllProducerDetails() { return of([]); }
  getQueryLibrary() { return of([]); }
  getPlantingCommodities() { return of([]); }
  // The user belongs to trade units even when none is SELECTED (group-only selection). The
  // library must gate on the explicit selection, not this fallback, because nothing loads
  // without an explicit trade unit - a prompt accepted here would spin forever.
  getUserTradeUnits() { return of([{ tradeUnitCodes: ['1000', '2000', '3000'] }]); }
  getTeamMembers() { return of([]); }
  getTeamSavedLists() { return of([]); }
  getNotes() { return of([]); }
  getDpContracts() { return of([]); }
  getCommodityConversions() { return of([]); }

  /** Lands batch N with the given customers; both the core forkJoin and the ticket read resolve. */
  land(index: number, customers: Customer[]): void {
    this.landCore(index, customers);
    this.landTickets(index);
  }
  landCore(index: number, customers: Customer[]): void {
    const b = this.batches[index];
    b.customers.next(customers); b.customers.complete();
  }
  landTickets(index: number): void {
    const b = this.batches[index];
    b.tickets.next([]); b.tickets.complete();
  }
}

function customer(id: number, name: string): Customer {
  return { id, name, sourceCustomerId: `C${id}`, isActive: true } as unknown as Customer;
}

const PROMPT: QueryLibraryItem = {
  id: 1, category: 'Contracts', name: 'All producers with contracts',
  queryText: 'All producers with contracts', sortOrder: 1,
};

describe('BuildListComponent - trade-unit reload keeps the library usable', () => {
  let api: ApiStub;
  let appState: AppStateService;

  beforeEach(() => {
    localStorage.clear();
    api = new ApiStub();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AppStateService,
        { provide: ApiService, useValue: api },
        { provide: DataPreloadService, useValue: {} },
        { provide: ToastService, useValue: { info: vi.fn(), error: vi.fn(), success: vi.fn() } },
        { provide: UsageTrackingService, useValue: { postClickEvent: vi.fn() } },
        { provide: UserRolesService, useValue: { isAdmin: () => false } },
        { provide: MsalService, useValue: { instance: { getActiveAccount: () => null, getAllAccounts: () => [] } } },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });
    // The template is 1,800 lines of real DOM; the behaviour under test is class-level.
    TestBed.overrideComponent(BuildListComponent, { set: { template: '', templateUrl: undefined, imports: [] } });
    appState = TestBed.inject(AppStateService);
    appState.setTradeUnits(['1000']);
  });

  function mount(): BuildListComponent {
    const fixture = TestBed.createComponent(BuildListComponent);
    fixture.detectChanges();
    TestBed.tick();
    return fixture.componentInstance;
  }

  it('a prompt picked while the new trade unit is still loading is parked, then runs when the data lands', () => {
    const c = mount();
    api.land(0, [customer(1, 'First TU Farm')]);
    expect(c.coreDataLoaded()).toBe(true);

    appState.setTradeUnits(['2000']);
    TestBed.tick();
    expect(c.loading()).toBe(true);
    expect(c.coreDataLoaded()).toBe(false);
    expect(api.batches.length).toBe(2);

    // The click the old gate refused. It must be accepted and parked, not dropped.
    c.selectLibraryQuery(PROMPT);
    expect(c.queryText()).toBe(PROMPT.queryText);
    expect(c.isProcessing()).toBe(true);
    expect(c.hasGenerated()).toBe(false);

    api.land(1, [customer(2, 'Second TU Farm')]);
    expect(c.coreDataLoaded()).toBe(true);
    expect(c.loading()).toBe(false);
    expect(c.isProcessing()).toBe(false);
    expect(c.hasGenerated()).toBe(true);
    expect(c.customers().map(x => x.id)).toEqual([2]);
  });

  it('a second trade-unit change drops the first reload instead of waiting on it', () => {
    const c = mount();
    api.land(0, []);

    appState.setTradeUnits(['2000']);
    TestBed.tick();
    appState.setTradeUnits(['2000', '3000']);
    TestBed.tick();
    expect(api.batches.length).toBe(3);

    // The superseded reload landing must change nothing - it was cancelled, not just ignored.
    api.land(1, [customer(9, 'Stale')]);
    expect(c.coreDataLoaded()).toBe(false);
    expect(c.customers()).toEqual([]);
    expect(api.batches[1].customers.observed).toBe(false);

    api.land(2, [customer(3, 'Current')]);
    expect(c.coreDataLoaded()).toBe(true);
    expect(c.customers().map(x => x.id)).toEqual([3]);
  });

  it('clears a parked prompt when the trade unit changes again before its data lands', () => {
    const c = mount();
    api.land(0, []);

    appState.setTradeUnits(['2000']);
    TestBed.tick();
    c.selectLibraryQuery(PROMPT);
    expect(c.isProcessing()).toBe(true);

    appState.setTradeUnits(['3000']);
    TestBed.tick();
    expect(c.queryText()).toBe('');
    expect(c.isProcessing()).toBe(false);

    api.land(2, [customer(4, 'Third')]);
    expect(c.hasGenerated()).toBe(false);
  });

  it('a parked ticket prompt re-enters processQuery when core data lands, so it waits on tickets by name', () => {
    // _dataReadyEffect only WAITS for data; it never starts a lazy fetch or sets the per-dataset
    // wait flags. Re-entering processQuery does both, so a ticket prompt parked mid-reload shows
    // "Loading ticket data..." rather than a generic spinner, and a note/DP prompt actually
    // kicks off its fetch instead of waiting forever.
    const c = mount();
    api.land(0, []);

    appState.setTradeUnits(['2000']);
    TestBed.tick();
    c.selectLibraryQuery({ ...PROMPT, queryText: 'Producers who delivered this month' });
    expect(c.isProcessing()).toBe(true);
    expect(c.waitingForTickets()).toBe(false);

    api.landCore(1, [customer(5, 'Delivering Farm')]);
    TestBed.tick();
    expect(c.waitingForTickets()).toBe(true);
    expect(c.hasGenerated()).toBe(false);

    api.landTickets(1);
    TestBed.tick();
    expect(c.waitingForTickets()).toBe(false);
    expect(c.isProcessing()).toBe(false);
    expect(c.hasGenerated()).toBe(true);
  });

  it('the template gates the prompt library on a trade unit only, never on the reload', () => {
    const html = readFileSync(join(process.cwd(), 'src', 'app', 'features', 'build-list', 'pages', 'build-list', 'build-list.component.html'), 'utf8');
    const at = html.indexOf('(click)="selectLibraryQuery(item)"');
    expect(at, 'library button click handler not found').toBeGreaterThan(-1);
    const button = html.slice(at, html.indexOf('>', at));
    expect(button).toContain('[disabled]="!hasSelectedTradeUnit()"');
    expect(button).not.toContain('coreDataLoaded');
    expect(button).not.toContain('!hasTradeUnits()');
    expect(html).toContain('Loading data for the selected trade units');
  });

  it('a saved list clicked during the cache-path background refresh keeps its hand-added members', () => {
    // Arriving from the producer home page: customers are already cached, so _initLoad enables the
    // page at once and refreshes in the background. A saved list clicked in that window runs its
    // OWN fetch (_fetchAndFilter). The background refresh landing must not re-enter processQuery
    // for it - that bumps _queryGenId, the list's fetch is discarded as superseded, and the
    // hand-added producers it would have resolved never appear.
    const roster = [customer(1, 'Regular Farm'), customer(7, 'Hand-added Farm')];
    appState.setCustomers(roster);
    const c = mount();
    expect(c.coreDataLoaded()).toBe(true);
    expect(c.loading()).toBe(false);
    expect(api.batches.length).toBe(1); // the background refresh

    const list: SavedList = { id: 1, name: 'Deliveries', query: 'Producers who delivered this month', includedCustomerIds: [7], createdAt: '' };
    c.loadSavedList(list);
    expect(c.isProcessing()).toBe(true);
    expect(api.batches.length).toBe(2); // the list's own fetch

    api.land(0, roster);          // background refresh lands first
    TestBed.tick();
    api.land(1, roster);          // then the list's fetch
    TestBed.tick();

    expect(c.isProcessing()).toBe(false);
    expect(c.hasGenerated()).toBe(true);
    expect(c.manuallyIncludedCustomers().map(x => x.id)).toEqual([7]);
  });

  it('deselecting every trade unit drops the reload that was in flight for the old one', () => {
    const c = mount();
    api.land(0, []);
    appState.setTradeUnits(['2000']);
    TestBed.tick();
    expect(c.loading()).toBe(true);

    appState.setTradeUnits([]);
    TestBed.tick();
    expect(c.loading()).toBe(false);
    expect(c.coreDataLoaded()).toBe(false);

    // The old reload landing must not re-open the page with the previous trade unit's roster.
    api.land(1, [customer(9, 'Old TU Farm')]);
    expect(c.coreDataLoaded()).toBe(false);
    expect(c.customers()).toEqual([]);
  });

  it('still refuses prompts when only a group is selected (no explicit trade unit)', () => {
    const c = mount();
    api.land(0, []);
    appState.setSelectedGroupNames(['Western']);
    appState.setTradeUnits([]);
    TestBed.tick();
    // The fallback says the user HAS trade units; the gate must ignore that.
    expect(c.hasTradeUnits()).toBe(true);
    expect(c.hasSelectedTradeUnit()).toBe(false);
    expect(c.coreDataLoaded()).toBe(false);
    expect(c.loading()).toBe(false);
    // ...because no reload is started for a group-only selection, so a parked prompt would never run.
    expect(api.batches.length).toBe(1);
  });
});
