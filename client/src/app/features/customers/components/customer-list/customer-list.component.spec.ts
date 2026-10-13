import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { MsalService } from '@azure/msal-angular';
import { CustomerListComponent } from './customer-list.component';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { NlqFilterContext, NlqFilterService } from '@core/services/nlq-filter.service';
import { UserTradeUnitsService } from '@core/services/user-trade-units.service';
import { Customer, NoteLastContact, ProducerDetails, ReminderDue, SavedList } from '@models';

// Behaviour safety net for the producer list ahead of its OnPush conversion. Pins, through the
// signal inputs and the rendered DOM:
//   - which empty state shows (no trade unit / loading / All Producers / no matches);
//   - the row content (acres badge vs "Not added", formatted location and phone, selection tint);
//   - the "last contacted" badge (day/month/year wording, colour tiers, linked-producer chains);
//   - the follow-up badge (soonest reminder wins, overdue/today/tomorrow/in-N wording);
//   - the debounced API search (TU / group scoping, ODS onboarding fallback and its 3-char floor,
//     producer-details overlay, error fallback, clearing, restore on remount, reset on TU change);
//   - the saved-list dropdown (trade-unit overlap visibility, NLQ filtering + manual overrides,
//     falling back to All Producers when the list disappears);
//   - Reset, and the dwell-gated prefetch output.
//
// AppStateService is the real one (pure signals; localStorage cleared per test). ApiService, MSAL
// and UserTradeUnitsService are stubbed. NlqFilterService is real except parseAndFilter, which is
// replaced by a deterministic "Kansas producers only" rule so the saved-list tests don't depend on
// the NLQ grammar. The real template renders, including the real TradeUnitSelectorComponent.

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Frozen clock. Every timer is faked so the 150ms search debounce and the 350ms prefetch dwell
 *  are driven explicitly with advanceTimersByTime. */
const NOW = new Date('2026-10-13T12:00:00');
const DAY = 24 * 60 * 60 * 1000;

/** Noon local time N days from the frozen "now". */
function daysFromNow(n: number): Date {
  const d = new Date(NOW.getTime() + n * DAY);
  d.setHours(12, 0, 0, 0);
  return d;
}

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 1, scoularId: 'SAMP1', name: 'Sample Farms', farm: 'Sample Farm Co', location: 'Pratt',
    stateProvince: 'KS', phone: '', email: '', totalAcres: 1200, linkedProducerIds: [],
    eSignEnabled: false, achEnabled: false, ...over,
  };
}

function makeList(over: Partial<SavedList> = {}): SavedList {
  return { id: 10, name: 'Kansas growers', query: 'kansas growers', tradeUnits: '2190', createdAt: '2026-09-01T00:00:00', ...over };
}

function makeLastContact(customerCode: string, daysAgo: number): NoteLastContact {
  return { customerId: 0, customerCode, lastNoteAt: daysFromNow(-daysAgo) };
}

function makeReminder(over: Partial<ReminderDue> = {}): ReminderDue {
  return { id: 1, customerId: 1, dueAt: '2026-10-20T12:00:00Z', ...over };
}

function makeDetails(over: Partial<ProducerDetails> = {}): ProducerDetails {
  return { id: 1, customerId: 1, customerName: 'Sample Farms', createdBy: 'test', createdAt: '2026-01-01T00:00:00', ...over };
}

const KANSAS = { groupName: 'Kansas', tradeUnitCodes: ['2191', '2190'] };
const NEBRASKA = { groupName: 'Nebraska', tradeUnitCodes: ['3001'] };

const LAST_CONTACT_LABEL = /^(Today|Never contacted|\d+ (day|days|month|months|year|years) ago)$/;
const FOLLOW_UP_LABEL = /^Follow-up /;

// ── Harness ───────────────────────────────────────────────────────────────────

describe('CustomerListComponent', () => {
  let fixture: ComponentFixture<CustomerListComponent>;
  let component: CustomerListComponent;
  let ref: ComponentRef<CustomerListComponent>;
  let appState: AppStateService;
  let nlq: NlqFilterService;
  let api: {
    searchCustomers: ReturnType<typeof vi.fn<(term: string, tradeUnits?: string[]) => Observable<Customer[]>>>;
    searchOdsCustomers: ReturnType<typeof vi.fn<(term: string) => Observable<Customer[]>>>;
    getStoredGrain: ReturnType<typeof vi.fn>;
    getDpContracts: ReturnType<typeof vi.fn>;
    getTickets: ReturnType<typeof vi.fn>;
    getPlantingIntentions: ReturnType<typeof vi.fn>;
    getContracts: ReturnType<typeof vi.fn>;
    getNotes: ReturnType<typeof vi.fn>;
    getQueryLibrary: ReturnType<typeof vi.fn>;
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
  const listSelect = (): HTMLSelectElement | null => host().querySelector<HTMLSelectElement>('select');
  const resetButton = (): HTMLButtonElement | null => host().querySelector<HTMLButtonElement>('button[title="Clear search and filters"]');

  /** The wrapper element of the badge span in a row whose text matches `label`. */
  function badgeFor(id: number, label: RegExp): HTMLElement | null {
    const span = Array.from(row(id).querySelectorAll('span')).find(s => label.test((s.textContent ?? '').trim()));
    return span?.parentElement ?? null;
  }
  const badgeText = (id: number, label: RegExp): string | undefined => badgeFor(id, label)?.textContent?.trim();

  /** Re-render after an app-state change the template doesn't read directly. */
  function render(): void {
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  }

  function create(inputs: {
    customers?: Customer[]; savedLists?: SavedList[]; noteLastContacts?: NoteLastContact[];
    myReminders?: ReminderDue[]; loading?: boolean; selectedCustomer?: Customer | null;
    producerDetailsMap?: Map<number, ProducerDetails>; linkedProducerCustomers?: Customer[];
  } = {}): void {
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

  function pickSavedList(id: string): void {
    const select = listSelect();
    if (!select) throw new Error('saved-list dropdown not rendered');
    select.value = id;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    api = {
      searchCustomers: vi.fn<(term: string, tradeUnits?: string[]) => Observable<Customer[]>>(() => of([])),
      searchOdsCustomers: vi.fn<(term: string) => Observable<Customer[]>>(() => of([])),
      getStoredGrain: vi.fn(() => of([])),
      getDpContracts: vi.fn(() => of([])),
      getTickets: vi.fn(() => of([])),
      getPlantingIntentions: vi.fn(() => of([])),
      getContracts: vi.fn(() => of([])),
      getNotes: vi.fn(() => of([])),
      getQueryLibrary: vi.fn(() => of([])),
    };
    nlq = new NlqFilterService();
    vi.spyOn(nlq, 'parseAndFilter').mockImplementation((_query: string, ctx: NlqFilterContext) => ({
      customers: ctx.customers.filter(c => c.stateProvince === 'KS'),
      detectedState: null,
      matchedPatterns: [],
    }));
    await TestBed.configureTestingModule({
      imports: [CustomerListComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: NlqFilterService, useValue: nlq },
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
    appState.setUserGroups([KANSAS, NEBRASKA]);
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
      appState.setTradeUnits(['2190']);
      render();
      expect(text()).toContain('Loading producers...');
      expect(resetButton()).not.toBeNull();

      ref.setInput('loading', false);
      fixture.detectChanges();
      expect(text()).not.toContain('Loading producers...');
      expect(text()).toContain('No producers found');
      expect(rows()).toHaveLength(0);
    });
  });

  // ── Row content ───────────────────────────────────────────────────────────

  describe('rows', () => {
    it('renders name, Scoular ID, acres, formatted location / phone, and e-mail only when present', () => {
      appState.setTradeUnits(['2190']);
      create({
        customers: [
          makeCustomer({ id: 1, name: 'Alpha Ag', scoularId: 'ALPHA', totalAcres: 1200, phone: '316.555.0142', email: 'alpha@example.com' }),
          makeCustomer({ id: 2, name: 'Bravo Bros', scoularId: 'BRAVO', location: '', stateProvince: 'NE', phone: '555-0142' }),
          makeCustomer({ id: 3, name: 'Charlie Co', scoularId: undefined, location: 'Hays', stateProvince: undefined }),
        ],
      });

      expect(rowNames()).toEqual(['Alpha Ag', 'Bravo Bros', 'Charlie Co']);
      expect(rowText(1)).toContain('ALPHA');
      expect(rowText(1)).toContain('1,200 acres');
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
      appState.setTradeUnits(['2190']);
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
      expect(appState.lastScrolledCustomerId()).toBe(1);
    });
  });

  // ── Last-contacted badge ──────────────────────────────────────────────────

  describe('last contacted badge', () => {
    it('words the most recent note by day / month / year and colours it by recency', () => {
      appState.setTradeUnits(['2190']);
      create({
        customers: [1, 2, 3, 4, 5, 6, 7].map(id => makeCustomer({ id, scoularId: `C${id}` })),
        noteLastContacts: [
          makeLastContact('C1', 0),
          makeLastContact('C2', 1),
          makeLastContact('C3', 40), makeLastContact('C3', 7),   // the most recent row wins
          makeLastContact('C4', 8),
          makeLastContact('C5', 45),
          makeLastContact('C6', 400),
          // C7: no notes at all
        ],
      });

      expect(badgeText(1, LAST_CONTACT_LABEL)).toBe('Today');
      expect(badgeFor(1, LAST_CONTACT_LABEL)?.className).toContain('text-green-500');
      expect(badgeText(2, LAST_CONTACT_LABEL)).toBe('1 day ago');
      expect(badgeText(3, LAST_CONTACT_LABEL)).toBe('7 days ago');
      expect(badgeFor(3, LAST_CONTACT_LABEL)?.className).toContain('text-green-500');   // ≤ 7 days
      expect(badgeText(4, LAST_CONTACT_LABEL)).toBe('8 days ago');
      expect(badgeFor(4, LAST_CONTACT_LABEL)?.className).toContain('text-yellow-500');  // 8–30 days
      expect(badgeText(5, LAST_CONTACT_LABEL)).toBe('1 month ago');
      expect(badgeFor(5, LAST_CONTACT_LABEL)?.className).toContain('text-red-500');     // > 30 days
      expect(badgeText(6, LAST_CONTACT_LABEL)).toBe('1 year ago');
      expect(badgeText(7, LAST_CONTACT_LABEL)).toBe('Never contacted');
      expect(badgeFor(7, LAST_CONTACT_LABEL)?.className).toContain('text-red-500');
    });

    it('surfaces the newest note across the whole linked-producer chain, including reverse links fetched separately', () => {
      appState.setTradeUnits(['2190']);
      create({
        customers: [
          makeCustomer({ id: 1, scoularId: 'A1', linkedProducerIds: ['B1'] }),
          makeCustomer({ id: 2, scoularId: 'B1', linkedProducerIds: ['C1'] }),
          makeCustomer({ id: 3, scoularId: 'C1' }),
          makeCustomer({ id: 4, scoularId: 'X1' }),   // only linked FROM an off-roster producer
        ],
        noteLastContacts: [makeLastContact('C1', 2), makeLastContact('Z1', 3)],
      });

      // A → B → C: A and B both see C's note from two days ago.
      expect(badgeText(1, LAST_CONTACT_LABEL)).toBe('2 days ago');
      expect(badgeText(2, LAST_CONTACT_LABEL)).toBe('2 days ago');
      expect(badgeText(4, LAST_CONTACT_LABEL)).toBe('Never contacted');

      // Z (another trade unit) links to X; once the home page supplies Z, X picks up Z's note.
      ref.setInput('linkedProducerCustomers', [makeCustomer({ id: 99, scoularId: 'Z1', linkedProducerIds: ['X1'] })]);
      fixture.detectChanges();
      expect(badgeText(4, LAST_CONTACT_LABEL)).toBe('3 days ago');
    });
  });

  // ── Follow-up badge ───────────────────────────────────────────────────────

  describe('follow-up badge', () => {
    it('shows the soonest open reminder per producer with overdue / today / tomorrow / in-N wording', () => {
      appState.setTradeUnits(['2190']);
      create({
        customers: [1, 2, 3, 4, 5].map(id => makeCustomer({ id, scoularId: `C${id}` })),
        myReminders: [
          makeReminder({ id: 1, customerId: 1, dueAt: '2026-10-18T12:00:00Z' }),
          makeReminder({ id: 2, customerId: 1, dueAt: '2026-10-11T12:00:00Z' }),   // soonest: 2 days overdue
          makeReminder({ id: 3, customerId: 2, dueAt: '2026-10-13T12:00:00Z' }),
          makeReminder({ id: 4, customerId: 3, dueAt: '2026-10-14T12:00:00Z' }),
          makeReminder({ id: 5, customerId: 4, dueAt: '2026-10-17T12:00:00Z' }),
          // customer 5: none
        ],
      });

      expect(badgeText(1, FOLLOW_UP_LABEL)).toBe('Follow-up overdue by 2 days');
      expect(badgeFor(1, FOLLOW_UP_LABEL)?.className).toContain('text-red-600');
      expect(badgeText(2, FOLLOW_UP_LABEL)).toBe('Follow-up today');
      expect(badgeFor(2, FOLLOW_UP_LABEL)?.className).toContain('text-amber-600');
      expect(badgeText(3, FOLLOW_UP_LABEL)).toBe('Follow-up tomorrow');
      expect(badgeText(4, FOLLOW_UP_LABEL)).toBe('Follow-up in 4 days');
      expect(badgeFor(4, FOLLOW_UP_LABEL)?.className).toContain('text-gray-500');
      expect(rowText(5)).not.toContain('Follow-up');

      // Completing every reminder clears the badges.
      ref.setInput('myReminders', []);
      fixture.detectChanges();
      expect(text()).not.toContain('Follow-up');
    });
  });

  // ── Search ────────────────────────────────────────────────────────────────

  describe('search', () => {
    it('debounces typing into one API search scoped to the selected trade units, overlaying producer details', () => {
      appState.setTradeUnits(['2190']);
      api.searchCustomers.mockReturnValue(of([makeCustomer({ id: 5, name: 'Smith Farms', totalAcres: 0 })]));
      create({
        customers: [makeCustomer({ id: 1, name: 'Alpha Ag' })],
        producerDetailsMap: new Map([[5, makeDetails({ customerId: 5, totalAcres: 900 })]]),
      });

      typeSearch('Smi', false);
      vi.advanceTimersByTime(100);
      typeSearch('  Smith ');

      expect(api.searchCustomers).toHaveBeenCalledTimes(1);
      expect(api.searchCustomers).toHaveBeenCalledWith('smith', ['2190']);   // trimmed + lower-cased
      expect(api.searchOdsCustomers).not.toHaveBeenCalled();
      expect(rowNames()).toEqual(['Smith Farms']);
      expect(rowText(5)).toContain('900 acres');            // ProducerDetails acres win over the search row
      expect(appState.searchQuery()).toBe('  Smith ');      // the raw term is what's persisted
    });

    it('scopes a group-only selection to the sorted union of that group\'s trade units, with no ODS fallback', () => {
      appState.setSelectedGroupNames(['Kansas']);
      create({ customers: [] });

      typeSearch('nobody');

      expect(api.searchCustomers).toHaveBeenCalledWith('nobody', ['2190', '2191']);
      expect(api.searchOdsCustomers).not.toHaveBeenCalled();   // any scope blocks the onboarding lookup
      expect(text()).toContain('No producers found');
    });

    it('falls back to the ODS master for unscoped searches of 3+ chars, marking hits "Not added"', () => {
      api.searchOdsCustomers.mockReturnValue(of([makeCustomer({ id: 70, name: 'Zed Ranch', totalAcres: 0 })]));
      create({ customers: [] });

      typeSearch('ze');
      expect(api.searchCustomers).toHaveBeenLastCalledWith('ze', undefined);
      expect(api.searchOdsCustomers).not.toHaveBeenCalled();    // too short for the slow master scan
      expect(text()).toContain('No producers found');

      typeSearch('zed');
      expect(api.searchOdsCustomers).toHaveBeenCalledWith('zed');
      expect(rowNames()).toEqual(['Zed Ranch']);
      expect(rowText(70)).toContain('Not added');
      expect(rowText(70)).not.toContain('acres');
    });

    it('shows the loaded roster when the search request fails', () => {
      appState.setTradeUnits(['2190']);
      api.searchCustomers.mockReturnValue(throwError(() => new Error('boom')));
      create({ customers: [makeCustomer({ id: 1, name: 'Alpha Ag' }), makeCustomer({ id: 2, name: 'Bravo Bros' })] });

      typeSearch('smith');

      expect(rowNames()).toEqual(['Alpha Ag', 'Bravo Bros']);
    });

    it('returns to the roster when the search is cleared with X or the trade-unit selection changes', () => {
      appState.setTradeUnits(['2190']);
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
      appState.setTradeUnits(['2191']);
      render();
      expect(component.searchInputValue).toBe('');
      expect(appState.searchQuery()).toBe('');
      expect(rowNames()).toEqual(['Alpha Ag']);
    });

    it('re-runs the search restored from app state when the list remounts', () => {
      appState.setTradeUnits(['2190']);
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

  // ── Saved lists ───────────────────────────────────────────────────────────

  describe('saved lists', () => {
    const roster = (): Customer[] => [
      makeCustomer({ id: 1, name: 'Alpha Ag', stateProvince: 'KS' }),
      makeCustomer({ id: 2, name: 'Bravo Bros', stateProvince: 'NE' }),
      makeCustomer({ id: 3, name: 'Charlie Co', stateProvince: 'KS' }),
    ];

    it('offers only overlapping lists once loaded, filters to the list\'s NLQ result with a member count, and back to all', () => {
      appState.setTradeUnits(['2190']);
      create({
        customers: roster(),
        loading: true,
        savedLists: [makeList({ id: 10, name: 'Kansas growers', tradeUnits: '2190,2191' }), makeList({ id: 11, name: 'Elsewhere', tradeUnits: '9999' })],
      });
      expect(listSelect()).toBeNull();   // hidden while the roster loads

      ref.setInput('loading', false);
      fixture.detectChanges();
      expect(Array.from(listSelect()!.options).map(o => o.textContent?.trim())).toEqual(['All Producers', 'Kansas growers']);
      expect(rowNames()).toEqual(['Alpha Ag', 'Bravo Bros', 'Charlie Co']);

      pickSavedList('10');
      expect(rowNames()).toEqual(['Alpha Ag', 'Charlie Co']);
      expect(appState.selectedSavedListId()).toBe('10');
      expect(listSelect()!.options[1].textContent?.trim()).toBe('Kansas growers (2)');
      expect(text()).not.toContain('Running saved list...');

      pickSavedList('all');
      expect(rowNames()).toEqual(['Alpha Ag', 'Bravo Bros', 'Charlie Co']);
      expect(appState.selectedSavedListId()).toBe('all');
    });

    it('applies manual includes / excludes, shows "No producers found" for an empty result, and falls back to all when the list disappears', () => {
      appState.setTradeUnits(['2190']);
      create({
        customers: roster(),
        savedLists: [
          makeList({ id: 10, includedCustomerIds: [2], excludedCustomerIds: [3] }),
          makeList({ id: 12, name: 'Nobody', excludedCustomerIds: [1, 3] }),
        ],
      });

      pickSavedList('10');
      expect(rowNames()).toEqual(['Alpha Ag', 'Bravo Bros']);

      pickSavedList('12');
      expect(rows()).toHaveLength(0);
      expect(text()).toContain('No producers found');

      ref.setInput('savedLists', [makeList({ id: 20, name: 'Another' })]);
      fixture.detectChanges();
      expect(appState.selectedSavedListId()).toBe('all');
      expect(rowNames()).toEqual(['Alpha Ag', 'Bravo Bros', 'Charlie Co']);
    });
  });

  // ── Reset ─────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears the trade-unit selection, saved list and search, and tells the parent to drop the selection', () => {
      appState.setTradeUnits(['2190']);
      appState.setSelectedGroupNames(['Kansas']);
      create({ customers: [makeCustomer({ id: 1, stateProvince: 'KS' })], savedLists: [makeList({ id: 10 })] });
      pickSavedList('10');
      let cleared = 0;
      component.clearSelection.subscribe(() => cleared++);

      resetButton()!.click();
      fixture.detectChanges();

      expect(cleared).toBe(1);
      expect(appState.selectedTradeUnits()).toEqual([]);
      expect(appState.selectedGroupNames()).toEqual([]);
      expect(appState.selectedSavedListId()).toBe('all');
      expect(appState.searchQuery()).toBe('');
      expect(text()).toContain('Select Trade Units');
      expect(resetButton()).toBeNull();
    });
  });
});
