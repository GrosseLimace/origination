import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChangeDetectionStrategy, Component, ComponentRef, input } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { MsalService } from '@azure/msal-angular';
import { CustomerListComponent } from './customer-list.component';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { UserTradeUnitsService } from '@core/services/user-trade-units.service';
import { Customer } from '@models';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { CustomerListFilter } from '@core/context/customer-list-filter';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { ModuleManifest } from '@core/modules/module-manifest';
import { APP_MODULES } from '@core/modules/module-registry';
import { CustomerListScrollStore } from '../../data-access/customer-list-scroll.store';
import { CustomerStore } from '../../data-access/customer.store';
import { CustomersApiService } from '../../data-access/customers-api.service';
import { PermissionStub, permissionStub, providePermissions } from '@testing/permission.stub';

// Behaviour safety net for the producer list ahead of its OnPush conversion. Pins, through the
// signal inputs and the rendered DOM:
//   - which empty state shows (no trade unit / loading / All Producers / no matches);
//   - the row content (formatted location and phone, "Not added", selection tint), and its row slots, where the
//     modules put their badges (Producers' acres, Engagement's last-contacted and follow-up lines: their own specs
//     cover those);
//   - the debounced API search (TU / group scoping, ODS onboarding fallback and its 3-char floor,
//     "Search failed" state, clearing, restore on remount, reset on TU change);
//   - its side of the list-filter slot: keeping who the filter keeps, waiting while it works them out, leaving a
//     search when a filter is picked, and clearing it on Reset (the saved-list picker that fills the slot, and its
//     runs, are the Lists module's: app.saved-list-filter.spec.ts covers the two together);
//   - Reset, and the dwell-gated prefetch output.
//
// AppStateService is the real one (pure signals; localStorage cleared per test). ApiService, MSAL
// and UserTradeUnitsService are stubbed. The real template renders, including the real
// TradeUnitSelectorComponent.

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Frozen clock. Every timer is faked so the 150ms search debounce and the 350ms prefetch dwell
 *  are driven explicitly with advanceTimersByTime. */
const NOW = new Date('2026-10-13T12:00:00');

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 1, scoularId: 'SAMP1', name: 'Sample Farms', location: 'Pratt',
    stateProvince: 'KS', phone: '', email: '',
    eSignEnabled: false, achEnabled: false, ...over,
  };
}

@Component({ selector: 'app-stub-tag', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: '<span>tag {{ customer().id }}</span>' })
class StubTag { readonly customer = input.required<Customer>(); }
@Component({ selector: 'app-stub-line', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: '<span>line {{ customer().id }}</span>' })
class StubLine { readonly customer = input.required<Customer>(); }
/** Stand-in panels for the rows' slots, shown only to a user holding notes:read, which only the row-slot test grants. */
const ROW_MODULES: ModuleManifest[] = [{
  id: 'engagement',
  customerPanels: [
    { slot: 'row-tags', id: 'tag', requires: ['notes:read'], order: 10, component: () => Promise.resolve(StubTag) },
    { slot: 'row-details', id: 'line', requires: ['notes:read'], order: 10, component: () => Promise.resolve(StubLine) },
  ],
}];

const KANSAS = { groupName: 'Kansas', tradeUnitCodes: ['2191', '2190'] };
const NEBRASKA = { groupName: 'Nebraska', tradeUnitCodes: ['3001'] };

// ── Harness ───────────────────────────────────────────────────────────────────

describe('CustomerListComponent', () => {
  let fixture: ComponentFixture<CustomerListComponent>;
  let component: CustomerListComponent;
  let ref: ComponentRef<CustomerListComponent>;
  let access: PermissionStub;
  let appState: AppStateService;
  let api: {
    searchCustomers: ReturnType<typeof vi.fn<(term: string, tradeUnits?: string[]) => Observable<Customer[]>>>;
    searchOdsCustomers: ReturnType<typeof vi.fn<(term: string) => Observable<Customer[]>>>;
  };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => host().textContent ?? '';
  const rows = (): HTMLElement[] => Array.from(host().querySelectorAll<HTMLElement>('[id^="customer-item-"]'));
  const rowNames = (): string[] => rows().map(r => (r.querySelector('p')?.textContent ?? '').trim());
  const row = (id: number): HTMLElement => {
    const el = host().querySelector<HTMLElement>(`#customer-item-${id}`);
    if (!el) throw new Error(`row ${id} not rendered`);
    return el;
  };
  const rowText = (id: number): string => (row(id).textContent ?? '').replace(/\s+/g, ' ').trim();
  const searchInput = (): HTMLInputElement => host().querySelector<HTMLInputElement>('input[placeholder="Search producers..."]')!;
  const resetButton = (): HTMLButtonElement | null => host().querySelector<HTMLButtonElement>('button[title="Clear search and filters"]');

  /** Re-render after an app-state change the template doesn't read directly. */
  function render(): void {
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  }

  function create(inputs: { customers?: Customer[]; loading?: boolean; selectedCustomer?: Customer | null } = {}): void {
    fixture = TestBed.createComponent(CustomerListComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    for (const [name, value] of Object.entries(inputs)) ref.setInput(name, value);
    fixture.detectChanges();
  }

  /** Types into the search box the way a user does, then (optionally) lets the 150ms debounce fire. */
  function typeSearch(value: string, settle = true): void {
    const input = searchInput();
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    if (settle) {
      vi.advanceTimersByTime(150);
      fixture.detectChanges();
    }
  }

  /** The filter the list provides to its list-filter slot. */
  const filter = (): CustomerListFilter => fixture.debugElement.injector.get(CustomerListFilter);

  /** The filter keeps these customers, as the panel in the slot would say. */
  function keep(kept: Parameters<CustomerListFilter['keep']>[0]): void {
    filter().keep(kept);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.clear();
    access = permissionStub();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    api = {
      searchCustomers: vi.fn<(term: string, tradeUnits?: string[]) => Observable<Customer[]>>(() => of([])),
      searchOdsCustomers: vi.fn<(term: string) => Observable<Customer[]>>(() => of([])),
    };
    await TestBed.configureTestingModule({
      imports: [CustomerListComponent],
      providers: [
        { provide: ApiService, useValue: api },
        // The searches are Customers' API client's; the list's other reads are still ApiService's.
        { provide: CustomersApiService, useExisting: ApiService },
        // The list-filter slot's host reads the selected customer, which the home page provides.
        SelectedCustomerContext,
        // The slots show the panels the user holds the permissions for: the stand-in row panels need one granted only
        // where they are tested.
        providePermissions(access),
        { provide: APP_MODULES, useValue: ROW_MODULES },
        {
          provide: MsalService,
          useValue: { instance: { getActiveAccount: () => ({ name: 'Caden Egr', username: 'cegr@scoular.com' }), getAllAccounts: () => [] } },
        },
        {
          provide: UserTradeUnitsService,
          useValue: { load: () => of([]), openPreferences: () => undefined, computeAvailableTradeUnits: () => [] },
        },
      ],
    }).compileComponents();
    appState = TestBed.inject(AppStateService);
    // Groups already loaded, so the embedded trade-unit selector never calls load().
    TestBed.inject(TradeUnitContext).setUserGroups([KANSAS, NEBRASKA]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Empty states ──────────────────────────────────────────────────────────

  describe('empty states', () => {
    it('walks no-trade-unit → All Producers → loading → no matches', () => {
      create({ customers: [], loading: true });
      // No trade unit: the loading spinner is suppressed in favour of the "pick one" prompt.
      expect(text()).toContain('Select Trade Units');
      expect(text()).not.toContain('Loading producers...');
      expect(resetButton()).toBeNull();

      appState.setAllProducersMode(true);
      render();
      expect(text()).not.toContain('Select Trade Units');
      expect(text()).toContain('Search for any producer');

      appState.setAllProducersMode(false);
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      render();
      expect(text()).toContain('Loading producers...');
      expect(resetButton()).not.toBeNull();

      ref.setInput('loading', false);
      fixture.detectChanges();
      expect(text()).not.toContain('Loading producers...');
      expect(text()).toContain('No producers found');
      expect(rows()).toHaveLength(0);
    });

    it('says the producer list failed to load instead of "No producers found"', () => {
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      TestBed.inject(CustomerStore).setCustomersLoadFailed(true);
      create({ customers: [] });

      expect(text()).toContain("Couldn't load producers");
      expect(text()).not.toContain('No producers found');
    });

    it('drops the failure message once producers arrive (e.g. the page\'s own retry succeeded)', () => {
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      TestBed.inject(CustomerStore).setCustomersLoadFailed(true);
      create({ customers: [] });

      ref.setInput('customers', [makeCustomer({ id: 1, scoularId: 'C1' })]);
      fixture.detectChanges();

      expect(text()).not.toContain("Couldn't load producers");
      expect(rows()).toHaveLength(1);
    });
  });

  // ── Row content ───────────────────────────────────────────────────────────

  describe('rows', () => {
    it('renders name, Scoular ID, formatted location / phone, and e-mail only when present', () => {
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      create({
        customers: [
          makeCustomer({ id: 1, name: 'Alpha Ag', scoularId: 'ALPHA', phone: '316.555.0142', email: 'alpha@example.com' }),
          makeCustomer({ id: 2, name: 'Bravo Bros', scoularId: 'BRAVO', location: '', stateProvince: 'NE', phone: '555-0142' }),
          makeCustomer({ id: 3, name: 'Charlie Co', scoularId: undefined, location: 'Hays', stateProvince: undefined }),
        ],
      });

      expect(rowNames()).toEqual(['Alpha Ag', 'Bravo Bros', 'Charlie Co']);
      expect(rowText(1)).toContain('ALPHA');
      expect(rowText(1)).toContain('Pratt, KS');
      expect(rowText(1)).toContain('(316) 555-0142');       // 10 digits → (XXX) XXX-XXXX
      expect(rowText(1)).toContain('alpha@example.com');
      expect(rowText(2)).toContain('NE');                    // state only
      expect(rowText(2)).toContain('555-0142');              // not 10 digits → left as typed
      expect(rowText(2)).not.toContain('@');
      expect(rowText(3)).toContain('Hays');                  // location only
      expect(rowText(3)).not.toContain('Not added');
      expect(rows().some(r => r.className.includes('bg-green-50'))).toBe(false);   // nothing selected yet
    });

    it('tints the selected row, emits clicks, and prefetches only after a 350ms hover dwell', () => {
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      const alpha = makeCustomer({ id: 1, name: 'Alpha Ag' });
      const bravo = makeCustomer({ id: 2, name: 'Bravo Bros' });
      create({ customers: [alpha, bravo], selectedCustomer: bravo });
      const picked: Customer[] = [];
      component.selectCustomer.subscribe(c => picked.push(c));
      const prefetched: Customer[] = [];
      component.prefetchCustomer.subscribe(c => prefetched.push(c));

      expect(row(2).className).toContain('bg-green-50');
      expect(row(1).className).not.toContain('bg-green-50');

      // Hover sweep: enter A, move to B before the dwell elapses, then leave B early too.
      row(1).dispatchEvent(new Event('mouseenter'));
      vi.advanceTimersByTime(200);
      row(2).dispatchEvent(new Event('mouseenter'));
      vi.advanceTimersByTime(200);
      row(2).dispatchEvent(new Event('mouseleave'));
      vi.advanceTimersByTime(1000);
      expect(prefetched).toEqual([]);

      row(1).dispatchEvent(new Event('mouseenter'));
      vi.advanceTimersByTime(349);
      expect(prefetched).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(prefetched).toEqual([alpha]);
      expect(picked).toEqual([]);                 // hovering never selects

      row(1).click();
      expect(picked).toEqual([alpha]);

      ref.setInput('selectedCustomer', alpha);
      fixture.detectChanges();
      expect(row(1).className).toContain('bg-green-50');
      expect(row(2).className).not.toContain('bg-green-50');
      expect(TestBed.inject(CustomerListScrollStore).lastScrolledCustomerId()).toBe(1);
    });
  });

  // ── The rows' slots ───────────────────────────────────────────────────────

  describe("the modules' row slots", () => {
    it("shows each row's tags beside the name (none for a customer not added yet) and its lines under the contact details", async () => {
      access.grant('notes:read');
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      create({ customers: [makeCustomer({ id: 1, name: 'Alpha Ag' }), makeCustomer({ id: 2, name: 'Zed', isOnboardCandidate: true })] });
      await vi.runAllTimersAsync();
      fixture.detectChanges();

      expect(row(1).querySelector('div')?.textContent).toContain('tag 1');
      expect(rowText(1)).toContain('line 1');
      expect(rowText(2)).not.toContain('tag');
      expect(rowText(2)).toContain('Not added');
      expect(rowText(2)).toContain('line 2');
    });
  });

  // ── Search ────────────────────────────────────────────────────────────────

  describe('search', () => {
    it('debounces typing into one API search scoped to the selected trade units', () => {
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      api.searchCustomers.mockReturnValue(of([makeCustomer({ id: 5, name: 'Smith Farms'})]));
      create({ customers: [makeCustomer({ id: 1, name: 'Alpha Ag' })] });

      typeSearch('Smi', false);
      vi.advanceTimersByTime(100);
      typeSearch('  Smith ');

      expect(api.searchCustomers).toHaveBeenCalledTimes(1);
      expect(api.searchCustomers).toHaveBeenCalledWith('smith', ['2190']);   // trimmed + lower-cased
      expect(api.searchOdsCustomers).not.toHaveBeenCalled();
      expect(rowNames()).toEqual(['Smith Farms']);
      expect(appState.searchQuery()).toBe('  Smith ');      // the raw term is what's persisted
    });

    it('scopes a group-only selection to the sorted union of that group\'s trade units, with no ODS fallback', () => {
      TestBed.inject(TradeUnitContext).setSelectedGroupNames(['Kansas']);
      create({ customers: [] });

      typeSearch('nobody');

      expect(api.searchCustomers).toHaveBeenCalledWith('nobody', ['2190', '2191']);
      expect(api.searchOdsCustomers).not.toHaveBeenCalled();   // any scope blocks the onboarding lookup
      expect(text()).toContain('No producers found');
    });

    it('falls back to the ODS master for unscoped searches of 3+ chars, marking hits "Not added"', () => {
      api.searchOdsCustomers.mockReturnValue(of([makeCustomer({ id: 70, name: 'Zed Ranch'})]));
      create({ customers: [] });

      typeSearch('ze');
      expect(api.searchCustomers).toHaveBeenLastCalledWith('ze', undefined);
      expect(api.searchOdsCustomers).not.toHaveBeenCalled();    // too short for the slow master scan
      expect(text()).toContain('No producers found');

      typeSearch('zed');
      expect(api.searchOdsCustomers).toHaveBeenCalledWith('zed');
      expect(rowNames()).toEqual(['Zed Ranch']);
      expect(rowText(70)).toContain('Not added');
    });

    // Changed deliberately: a failed search used to fall back to the whole loaded roster, which
    // read as "everyone matched". It now shows no rows and an inline "Search failed" state.
    it('shows a "Search failed" state, not the loaded roster, when the search request fails', () => {
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      api.searchCustomers.mockReturnValue(throwError(() => new Error('boom')));
      create({ customers: [makeCustomer({ id: 1, name: 'Alpha Ag' }), makeCustomer({ id: 2, name: 'Bravo Bros' })] });

      typeSearch('smith');

      expect(rows()).toHaveLength(0);
      expect(text()).toContain('Search failed');
      expect(text()).not.toContain('No producers found');
      expect(host().querySelector('[role="alert"]')).not.toBeNull();
    });

    it('clears the failed state on the next successful search, and on clearing the search', () => {
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      api.searchCustomers.mockReturnValue(throwError(() => new Error('boom')));
      create({ customers: [makeCustomer({ id: 1, name: 'Alpha Ag' })] });
      typeSearch('smith');
      expect(text()).toContain('Search failed');

      // Retry succeeds — results replace the failed state.
      api.searchCustomers.mockReturnValue(of([makeCustomer({ id: 5, name: 'Smith Farms' })]));
      typeSearch('smith');
      expect(text()).not.toContain('Search failed');
      expect(rowNames()).toEqual(['Smith Farms']);

      // Fails again, then the user clears the box with X — back to the roster, no failed state.
      api.searchCustomers.mockReturnValue(throwError(() => new Error('boom')));
      typeSearch('smithy');
      expect(text()).toContain('Search failed');
      host().querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!.click();
      fixture.detectChanges();
      expect(text()).not.toContain('Search failed');
      expect(rowNames()).toEqual(['Alpha Ag']);
    });

    it('still shows "No producers found" (not "Search failed") when the ODS onboarding lookup errors', () => {
      // The ODS fallback is a best-effort extra lookup after a successful empty search; its own
      // failure is swallowed to an empty result, unchanged by the search-failure fix.
      api.searchOdsCustomers.mockReturnValue(throwError(() => new Error('ods down')));
      create({ customers: [] });

      typeSearch('zed');

      expect(api.searchOdsCustomers).toHaveBeenCalledWith('zed');
      expect(text()).toContain('No producers found');
      expect(text()).not.toContain('Search failed');
    });

    it('returns to the roster when the search is cleared with X or the trade-unit selection changes', () => {
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      api.searchCustomers.mockReturnValue(of([makeCustomer({ id: 5, name: 'Smith Farms' })]));
      create({ customers: [makeCustomer({ id: 1, name: 'Alpha Ag' })] });
      typeSearch('smith');
      expect(rowNames()).toEqual(['Smith Farms']);

      host().querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!.click();
      fixture.detectChanges();
      expect(rowNames()).toEqual(['Alpha Ag']);
      expect(appState.searchQuery()).toBe('');
      expect(host().querySelector('button[aria-label="Clear search"]')).toBeNull();

      typeSearch('smith');
      expect(rowNames()).toEqual(['Smith Farms']);
      TestBed.inject(TradeUnitContext).setTradeUnits(['2191']);
      render();
      expect(component.searchInputValue).toBe('');
      expect(appState.searchQuery()).toBe('');
      expect(rowNames()).toEqual(['Alpha Ag']);
    });

    it('re-runs the search restored from app state when the list remounts', () => {
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      appState.setSearchQuery('smith');
      api.searchCustomers.mockReturnValue(of([makeCustomer({ id: 5, name: 'Smith Farms' })]));
      create({ customers: [makeCustomer({ id: 1, name: 'Alpha Ag' })] });

      vi.advanceTimersByTime(150);
      fixture.detectChanges();

      expect(component.searchInputValue).toBe('smith');
      expect(api.searchCustomers).toHaveBeenCalledWith('smith', ['2190']);
      expect(rowNames()).toEqual(['Smith Farms']);
    });
  });

  // ── The list-filter slot ──────────────────────────────────────────────────

  describe('the filter in the list-filter slot', () => {
    const roster = (): Customer[] => [
      makeCustomer({ id: 1, name: 'Alpha Ag', stateProvince: 'KS' }),
      makeCustomer({ id: 2, name: 'Bravo Bros', stateProvince: 'NE' }),
      makeCustomer({ id: 3, name: 'Charlie Co', stateProvince: 'KS' }),
    ];

    it('keeps who the filter keeps, shows Reset meanwhile, and every customer again when it keeps all', () => {
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      create({ customers: roster() });
      keep({ kind: 'some', ids: new Set([1, 3]) });
      expect(rowNames()).toEqual(['Alpha Ag', 'Charlie Co']);
      expect(resetButton()).not.toBeNull();

      keep({ kind: 'all' });
      expect(rowNames()).toEqual(['Alpha Ag', 'Bravo Bros', 'Charlie Co']);
    });

    it('shows "No producers found" when the filter keeps nobody', () => {
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      create({ customers: roster() });
      keep({ kind: 'some', ids: new Set() });
      expect(rows()).toHaveLength(0);
      expect(text()).toContain('No producers found');
    });

    // Rather than flashing every customer while a list is still worked out.
    it("keeps what it shows, with the filter's message, while the filter works out who it keeps", () => {
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      create({ customers: roster() });
      keep({ kind: 'some', ids: new Set([1]) });
      keep({ kind: 'pending', message: 'Running saved list...' });
      expect(text()).toContain('Running saved list...');
      expect(rows()).toHaveLength(0);
      // Underneath the spinner too: not every customer, the bug a second pick once showed for a moment.
      expect(component.filteredCustomers().map(c => c.id)).toEqual([1]);

      keep({ kind: 'some', ids: new Set([2]) });
      expect(text()).not.toContain('Running saved list...');
      expect(rowNames()).toEqual(['Bravo Bros']);
    });

    it("narrows a search's results too", () => {
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      api.searchCustomers.mockReturnValue(of(roster()));
      create({ customers: roster() });
      keep({ kind: 'some', ids: new Set([3]) });
      typeSearch('co');
      expect(rowNames()).toEqual(['Charlie Co']);
    });

    // So the picked filter applies to the trade units' customers, not to a search's results.
    it('leaves the search when a filter is picked', () => {
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      create({ customers: roster() });
      typeSearch('alpha');
      expect(appState.searchQuery()).toBe('alpha');

      filter().pick();
      fixture.detectChanges();

      expect(component.searchInputValue).toBe('');
      expect(appState.searchQuery()).toBe('');
    });

    it('hides the slot while the producers load, keeping its filter', () => {
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      create({ customers: roster(), loading: true });
      const slot = host().querySelector('app-customer-slot');
      expect(slot?.parentElement?.classList).toContain('hidden');

      ref.setInput('loading', false);
      fixture.detectChanges();
      expect(slot?.parentElement?.classList).not.toContain('hidden');
    });
  });

  // ── Reset ─────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears the trade-unit selection, the filter and the search, and tells the parent to drop the selection', () => {
      TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
      TestBed.inject(TradeUnitContext).setSelectedGroupNames(['Kansas']);
      create({ customers: [makeCustomer({ id: 1, stateProvince: 'KS' })] });
      keep({ kind: 'some', ids: new Set([1]) });
      let cleared = 0;
      component.clearSelection.subscribe(() => cleared++);
      // The panel in the slot answers a reset by keeping every customer again.
      let filterCleared = 0;
      filter().reset.subscribe(() => { filterCleared++; filter().keep({ kind: 'all' }); });

      resetButton()!.click();
      fixture.detectChanges();

      expect(cleared).toBe(1);
      expect(TestBed.inject(TradeUnitContext).selectedTradeUnits()).toEqual([]);
      expect(TestBed.inject(TradeUnitContext).selectedGroupNames()).toEqual([]);
      expect(filterCleared).toBe(1);
      expect(appState.searchQuery()).toBe('');
      expect(text()).toContain('Select Trade Units');
      expect(resetButton()).toBeNull();
    });
  });
});
