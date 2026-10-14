import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { UnshippedBushelsComponent } from './unshipped-bushels.component';
import { AppStateService } from '@core/services/app-state.service';
import { ApiService } from '@core/services/api.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Contract, Customer } from '@models';

// Behaviour safety net for the Unshipped Bushels page: which contracts count as unshipped (the shared
// contract-delivery rule — sub-0.1% residue is filled, a null open balance is the whole quantity),
// grouping by CTRM customer id with the producer's name (or the code / "Unknown" when there's no
// match), groups sorted by open bushels and rows by delivery end, the summary cards, the cache-first
// load with its API fallback + loading + error states, expand / collapse (and its usage event), the
// three search boxes (group visibility vs row filtering, the milo/beans aliases), Clear filters, the
// empty states, navigation to the producer, and the debounced search-tracking event. Driven through
// the injected state, real DOM clicks and typed input — the page's mutable group objects and plain
// getters are exactly what an OnPush conversion could stop re-rendering.

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Noon local time on a calendar date (1-based month). */
function on(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 42, scoularId: 'SAMPFRM', name: 'Sample Farms', farm: 'Sample Farms', location: 'Pratt, KS',
    phone: '', email: '', totalAcres: 0, linkedProducerIds: [], eSignEnabled: false, achEnabled: false, ...over,
  };
}

/** A 10,000 BU corn contract for SAMPFRM with 4,000 BU still to ship. */
function makeContract(over: Partial<Contract> = {}): Contract {
  return {
    id: 1, customerId: 42, ctrmCustomerId: 'SAMPFRM', sourceContractId: 'PCW100', farmId: 'F1',
    contractNumber: '100', commodityCode: 'YC', commodityDescription: 'Corn', commodityGroup: 'Corn',
    quantity: 10000, openBalanceQuantity: 4000, unit: 'BU', price: 0, cropYear: 2026,
    deliveryStart: on(2026, 9, 1), deliveryEnd: on(2026, 11, 30),
    status: 'Active', signed: true, ...over,
  };
}

const SAMPLE = makeCustomer({ id: 42, scoularId: 'SAMPFRM', name: 'Sample Farms' });
const PRAIRIE = makeCustomer({ id: 7, scoularId: 'PRAIRIE', name: 'Prairie Acres' });

// ── Harness ───────────────────────────────────────────────────────────────────

describe('UnshippedBushelsComponent', () => {
  let fixture: ComponentFixture<UnshippedBushelsComponent>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let getContracts: ReturnType<typeof vi.fn>;
  let toastError: ReturnType<typeof vi.fn>;
  let postClickEvent: ReturnType<typeof vi.fn>;
  const contracts = signal<Contract[]>([]);
  const customers = signal<Customer[]>([]);
  const selectedTradeUnits = signal<string[]>([]);
  const setContracts = vi.fn((c: Contract[]) => contracts.set(c));

  /** Seeds the app-state cache, then builds the page and runs ngOnInit + the first render. */
  function createPage(seed: { contracts?: Contract[]; customers?: Customer[] } = {}): void {
    contracts.set(seed.contracts ?? []);
    customers.set(seed.customers ?? []);
    fixture = TestBed.createComponent(UnshippedBushelsComponent);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  }

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const textOf = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const hasText = (s: string): boolean => textOf(host()).includes(s);

  /** [Total Open Bushels, Producers, Open Contracts] — empty while loading. */
  const summaryCards = (): string[] => Array.from(host().querySelectorAll('app-card .text-2xl.font-bold')).map(textOf);

  const groupHeaders = (): HTMLButtonElement[] => Array.from(host().querySelectorAll<HTMLButtonElement>('button.w-full.text-left'));
  interface RenderedGroup { name: string; code: string; badge: string; open: string; canNavigate: boolean }
  const groups = (): RenderedGroup[] => groupHeaders().map(h => ({
    name: textOf(h.querySelector('.font-semibold')),
    code: textOf(h.querySelector('.font-mono')),
    badge: textOf(h.querySelector('app-badge')),
    open: textOf(h.querySelector('.text-lg.font-bold')),
    canNavigate: h.querySelector('button[title="View producer"]') !== null,
  }));
  const header = (name: string): HTMLButtonElement => {
    const h = groupHeaders().find(b => textOf(b.querySelector('.font-semibold')) === name);
    if (!h) throw new Error(`No group "${name}"`);
    return h;
  };

  /** Expanded contract rows, each as its six cell texts. */
  const contractRows = (): HTMLElement[] => Array.from(host().querySelectorAll<HTMLElement>('div.grid-cols-12[title="View producer"]'));
  const rowCells = (): string[][] => contractRows().map(r => Array.from(r.children).map(textOf));

  function click(el: Element): void {
    (el as HTMLElement).click();
    fixture.detectChanges();
  }

  function type(placeholder: string, value: string): void {
    const input = host().querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(host().querySelectorAll<HTMLButtonElement>('button')).find(b => textOf(b) === label);

  beforeEach(async () => {
    contracts.set([]);
    customers.set([]);
    selectedTradeUnits.set([]);
    setContracts.mockClear();
    getContracts = vi.fn(() => of<Contract[]>([]));
    toastError = vi.fn();
    postClickEvent = vi.fn();
    await TestBed.configureTestingModule({
      imports: [UnshippedBushelsComponent],
      providers: [
        provideRouter([]),
        { provide: AppStateService, useValue: { contracts, customers, selectedTradeUnits, setContracts } },
        { provide: ApiService, useValue: { getContracts } },
        { provide: ToastService, useValue: { error: toastError } },
        { provide: UsageTrackingService, useValue: { postClickEvent } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── What counts as unshipped, grouping, sorting ───────────────────────────

  it('groups unshipped contracts by CTRM customer, named from the customer list, largest open balance first', () => {
    createPage({
      customers: [SAMPLE, PRAIRIE],
      contracts: [
        makeContract({ id: 1, ctrmCustomerId: 'SAMPFRM', openBalanceQuantity: 4000 }),
        makeContract({ id: 2, ctrmCustomerId: 'SAMPFRM', openBalanceQuantity: 1000 }),
        makeContract({ id: 3, ctrmCustomerId: 'PRAIRIE', openBalanceQuantity: 9000 }),
        makeContract({ id: 4, ctrmCustomerId: 'NOMATCH', openBalanceQuantity: 2000 }),          // not in the customer list
        makeContract({ id: 5, ctrmCustomerId: undefined, customerId: 99, openBalanceQuantity: 300 }), // no CTRM id at all
      ],
    });

    expect(groups()).toEqual([
      { name: 'Prairie Acres', code: 'PRAIRIE', badge: '1 contract', open: '9,000', canNavigate: true },
      { name: 'Sample Farms', code: 'SAMPFRM', badge: '2 contracts', open: '5,000', canNavigate: true },
      { name: 'NOMATCH', code: 'NOMATCH', badge: '1 contract', open: '2,000', canNavigate: false },
      { name: 'Unknown', code: 'unknown_99', badge: '1 contract', open: '300', canNavigate: false },
    ]);
    expect(summaryCards()).toEqual(['16,300', '4', '5']);
    expect(hasText('4 producers • 16,300 open bu')).toBe(true);
    // The cache had contracts, so the API was never asked.
    expect(getContracts).not.toHaveBeenCalled();
  });

  it('drops delivered contracts — zero balance or sub-0.1% residue — and counts a missing balance as the full quantity', () => {
    createPage({
      customers: [SAMPLE],
      contracts: [
        makeContract({ id: 1, quantity: 10000, openBalanceQuantity: 0 }),          // filled
        makeContract({ id: 2, quantity: 10000, openBalanceQuantity: 9.99 }),       // < 0.1% → filled
        makeContract({ id: 3, quantity: 10000, openBalanceQuantity: 10 }),         // exactly 0.1% → still open
        makeContract({ id: 4, quantity: 2500, openBalanceQuantity: undefined }),   // CTRM hasn't populated it
      ],
    });

    expect(groups()).toEqual([expect.objectContaining({ badge: '2 contracts', open: '2,510' })]);
    expect(summaryCards()).toEqual(['2,510', '1', '2']);
  });

  it('shows "No unshipped bushels found" (and no Expand all) when nothing is left to ship', () => {
    createPage({ customers: [SAMPLE], contracts: [makeContract({ openBalanceQuantity: 0 })] });

    expect(groups()).toEqual([]);
    expect(hasText('No unshipped bushels found')).toBe(true);
    expect(button('Expand all')).toBeUndefined();
    expect(summaryCards()).toEqual(['0', '0', '0']);
  });

  // ── Loading ───────────────────────────────────────────────────────────────

  it('falls back to the API for the selected trade units, shows a spinner meanwhile, and fills the cache', () => {
    const response = new Subject<Contract[]>();
    getContracts.mockReturnValue(response);
    selectedTradeUnits.set(['3811', '1200']);

    createPage({ customers: [SAMPLE] });

    expect(getContracts).toHaveBeenCalledWith(['3811', '1200']);
    expect(hasText('Loading contracts...')).toBe(true);
    expect(summaryCards()).toEqual([]);
    expect(hasText('No unshipped bushels found')).toBe(false);

    const loaded = [makeContract({ id: 1, openBalanceQuantity: 700 })];
    response.next(loaded);
    response.complete();
    fixture.detectChanges();

    expect(setContracts).toHaveBeenCalledWith(loaded);
    expect(hasText('Loading contracts...')).toBe(false);
    expect(groups()).toEqual([expect.objectContaining({ name: 'Sample Farms', open: '700' })]);
  });

  it('asks for every trade unit when none is selected, and toasts + shows the empty state when that load fails', () => {
    getContracts.mockReturnValue(throwError(() => new Error('boom')));

    createPage();

    expect(getContracts).toHaveBeenCalledWith(undefined);
    expect(toastError).toHaveBeenCalledWith('Failed to load contracts');
    expect(hasText('Loading contracts...')).toBe(false);
    expect(hasText('No unshipped bushels found')).toBe(true);
    expect(setContracts).not.toHaveBeenCalled();
  });

  it('drops the spinner for the empty state when a pending load fails after the first render', () => {
    // throwError above fails inside the first render; a real request fails later, when only the
    // loading flag changes.
    const response = new Subject<Contract[]>();
    getContracts.mockReturnValue(response);

    createPage();
    expect(hasText('Loading contracts...')).toBe(true);

    response.error(new Error('boom'));
    fixture.detectChanges();

    expect(toastError).toHaveBeenCalledWith('Failed to load contracts');
    expect(hasText('Loading contracts...')).toBe(false);
    expect(hasText('No unshipped bushels found')).toBe(true);
  });

  // ── Expand / collapse ─────────────────────────────────────────────────────

  it('expands a producer to its contracts, soonest delivery end first, and logs only the expand', () => {
    createPage({
      customers: [SAMPLE],
      contracts: [
        makeContract({ id: 1, contractNumber: '300', deliveryEnd: on(2027, 3, 31), quantity: 5000, openBalanceQuantity: 5000 }),
        makeContract({ id: 2, contractNumber: '', sourceContractId: 'PCW200', commodityDescription: '', commodityCode: 'SB',
          cropYear: undefined, deliveryEnd: on(2026, 11, 30), quantity: 12000, openBalanceQuantity: 2500.5 }),
        makeContract({ id: 3, contractNumber: '100', deliveryEnd: on(2026, 10, 15), quantity: 8000, openBalanceQuantity: 1000 }),
      ],
    });
    expect(contractRows()).toEqual([]);

    click(header('Sample Farms'));

    expect(rowCells()).toEqual([
      ['100', 'Corn', '2026', 'Oct 15, 2026', '8,000', '1,000'],
      ['PCW200', 'SB', '—', 'Nov 30, 2026', '12,000', '2,500.5'],
      ['300', 'Corn', '2026', 'Mar 31, 2027', '5,000', '5,000'],
    ]);
    expect(postClickEvent).toHaveBeenCalledTimes(1);
    expect(postClickEvent).toHaveBeenCalledWith('interaction', 'unshipped-bushels', 'group-expanded', 'SAMPFRM');

    click(header('Sample Farms'));

    expect(contractRows()).toEqual([]);
    expect(postClickEvent).toHaveBeenCalledTimes(1);
  });

  it('expands and collapses every producer at once', () => {
    createPage({
      customers: [SAMPLE, PRAIRIE],
      contracts: [makeContract({ id: 1, ctrmCustomerId: 'SAMPFRM' }), makeContract({ id: 2, ctrmCustomerId: 'PRAIRIE' })],
    });

    click(button('Expand all')!);
    expect(contractRows()).toHaveLength(2);

    click(button('Collapse all')!);
    expect(contractRows()).toHaveLength(0);
  });

  // ── Search ────────────────────────────────────────────────────────────────

  it('filters producers by name or code, case-insensitively, and the summary follows the filter', () => {
    createPage({
      customers: [SAMPLE, PRAIRIE],
      contracts: [
        makeContract({ id: 1, ctrmCustomerId: 'SAMPFRM', openBalanceQuantity: 4000 }),
        makeContract({ id: 2, ctrmCustomerId: 'PRAIRIE', openBalanceQuantity: 9000 }),
      ],
    });

    type('Search by producer...', '  prairie ');
    expect(groups().map(g => g.name)).toEqual(['Prairie Acres']);
    expect(summaryCards()).toEqual(['9,000', '1', '1']);

    type('Search by producer...', 'sampf');
    expect(groups().map(g => g.name)).toEqual(['Sample Farms']);
  });

  it('shows "No results match your filters" with a Clear filters button that restores the full list', async () => {
    createPage({ customers: [SAMPLE, PRAIRIE], contracts: [makeContract({ id: 1 }), makeContract({ id: 2, ctrmCustomerId: 'PRAIRIE' })] });
    expect(button('Clear filters')).toBeUndefined();

    type('Search by contract #...', 'zzz');

    expect(groups()).toEqual([]);
    expect(hasText('No results match your filters')).toBe(true);
    expect(hasText('No unshipped bushels found')).toBe(false);

    click(button('Clear filters')!);

    expect(groups()).toHaveLength(2);
    // ngModel writes the cleared value back to the box on a microtask.
    await fixture.whenStable();
    expect(host().querySelector<HTMLInputElement>('input[placeholder="Search by contract #..."]')!.value).toBe('');
  });

  it('keeps a producer visible when any contract matches the commodity, and lists only the matching rows', () => {
    createPage({
      customers: [SAMPLE, PRAIRIE],
      contracts: [
        makeContract({ id: 1, ctrmCustomerId: 'SAMPFRM', contractNumber: '1', commodityDescription: 'Corn', commodityCode: 'YC', openBalanceQuantity: 4000 }),
        makeContract({ id: 2, ctrmCustomerId: 'SAMPFRM', contractNumber: '2', commodityDescription: 'Soybeans', commodityCode: 'SB', openBalanceQuantity: 1000 }),
        makeContract({ id: 3, ctrmCustomerId: 'PRAIRIE', contractNumber: '3', commodityDescription: 'Corn', commodityCode: 'YC', openBalanceQuantity: 9000 }),
      ],
    });

    type('Filter by commodity...', 'SOY');
    click(button('Expand all')!);

    expect(groups().map(g => g.name)).toEqual(['Sample Farms']);
    expect(rowCells().map(c => c[0])).toEqual(['2']);
    // The group's badge, open total and the summary still describe the WHOLE group, not just the matching rows.
    expect(groups()[0]).toEqual(expect.objectContaining({ badge: '2 contracts', open: '5,000' }));
    expect(summaryCards()).toEqual(['5,000', '1', '2']);
  });

  it('matches the contract filter on either the contract number or the source contract id', () => {
    createPage({
      customers: [SAMPLE, PRAIRIE],
      contracts: [
        makeContract({ id: 1, ctrmCustomerId: 'SAMPFRM', contractNumber: '4512', sourceContractId: 'PCW4512' }),
        makeContract({ id: 2, ctrmCustomerId: 'SAMPFRM', contractNumber: '7001', sourceContractId: 'PCW7001' }),
        makeContract({ id: 3, ctrmCustomerId: 'PRAIRIE', contractNumber: '8800', sourceContractId: 'PSB8800' }),
      ],
    });
    click(button('Expand all')!);

    type('Search by contract #...', 'pcw7');
    expect(groups().map(g => g.name)).toEqual(['Sample Farms']);
    expect(rowCells().map(c => c[0])).toEqual(['7001']);

    type('Search by contract #...', '88');
    expect(groups().map(g => g.name)).toEqual(['Prairie Acres']);
    expect(rowCells().map(c => c[0])).toEqual(['8800']);
  });

  it('widens the expanded rows through the milo / sorghum alias once the producer is visible', () => {
    createPage({
      customers: [SAMPLE],
      contracts: [
        makeContract({ id: 1, contractNumber: '1', commodityDescription: 'Milo', commodityCode: 'MI' }),
        makeContract({ id: 2, contractNumber: '2', commodityDescription: 'Grain Sorghum', commodityCode: 'GS' }),
        makeContract({ id: 3, contractNumber: '3', commodityDescription: 'Corn', commodityCode: 'YC' }),
      ],
    });
    click(button('Expand all')!);

    type('Filter by commodity...', 'milo');

    expect(rowCells().map(c => c[0]).sort()).toEqual(['1', '2']);
  });

  it('applies the alias when deciding which producers to show, not just to the expanded rows', () => {
    // Was pinned as a bug: the producer filter matched the raw term while the rows expanded the
    // alias, so a producer whose only open contract is "Sorghum" vanished on a "milo" search.
    // Both filters now share one alias expansion.
    createPage({
      customers: [SAMPLE, PRAIRIE],
      contracts: [
        makeContract({ id: 1, ctrmCustomerId: 'SAMPFRM', contractNumber: '1', commodityDescription: 'Sorghum', commodityCode: 'SOR', openBalanceQuantity: 3000 }),
        makeContract({ id: 2, ctrmCustomerId: 'PRAIRIE', contractNumber: '2', commodityDescription: 'Soybeans', commodityCode: 'SB', openBalanceQuantity: 2000 }),
      ],
    });
    click(button('Expand all')!);

    type('Filter by commodity...', 'milo');
    expect(groups().map(g => g.name)).toEqual(['Sample Farms']);
    expect(rowCells().map(c => c[0])).toEqual(['1']);
    expect(summaryCards()).toEqual(['3,000', '1', '1']);
    expect(hasText('No results match your filters')).toBe(false);

    type('Filter by commodity...', 'beans');
    expect(groups().map(g => g.name)).toEqual(['Prairie Acres']);
    expect(rowCells().map(c => c[0])).toEqual(['2']);
  });

  it('shows a producer on a commodity search exactly when it has at least one matching row', () => {
    createPage({
      customers: [SAMPLE, PRAIRIE],
      contracts: [
        makeContract({ id: 1, ctrmCustomerId: 'SAMPFRM', contractNumber: '1', commodityDescription: 'Grain Sorghum', commodityCode: 'GS' }),
        makeContract({ id: 2, ctrmCustomerId: 'SAMPFRM', contractNumber: '2', commodityDescription: 'Corn', commodityCode: 'YC' }),
        makeContract({ id: 3, ctrmCustomerId: 'PRAIRIE', contractNumber: '3', commodityDescription: 'Soybeans', commodityCode: 'SB' }),
        makeContract({ id: 4, ctrmCustomerId: 'PRAIRIE', contractNumber: '4', commodityDescription: 'Milo', commodityCode: 'MI' }),
      ],
    });
    click(button('Expand all')!);

    const rowsPerProducer = (): number[] => groupHeaders()
      .map(h => h.closest('app-card')!.querySelectorAll('div.grid-cols-12[title="View producer"]').length);
    const shown: Record<string, string[]> = {};
    for (const term of ['milo', 'sorghum', 'beans', 'soybeans', 'corn', 'wheat']) {
      type('Filter by commodity...', term);
      expect(rowsPerProducer().every(n => n > 0), term).toBe(true);
      shown[term] = groups().map(g => g.name).sort();
    }
    expect(shown).toEqual({
      milo: ['Prairie Acres', 'Sample Farms'],
      sorghum: ['Prairie Acres', 'Sample Farms'],
      beans: ['Prairie Acres'],
      soybeans: ['Prairie Acres'],
      corn: ['Sample Farms'],
      wheat: [],
    });
  });

  // ── Navigation ────────────────────────────────────────────────────────────

  it('opens the producer from the header link (without toggling) or any contract row — but only for a known producer', () => {
    createPage({
      customers: [SAMPLE],
      contracts: [makeContract({ id: 1, openBalanceQuantity: 9000 }), makeContract({ id: 2, ctrmCustomerId: 'NOMATCH', openBalanceQuantity: 100 })],
    });

    click(header('Sample Farms').querySelector('button[title="View producer"]')!);

    expect(navigate).toHaveBeenCalledWith(['/'], { queryParams: { customerId: 42 } });
    expect(contractRows()).toEqual([]);              // stopPropagation: the header did not expand
    expect(postClickEvent).not.toHaveBeenCalled();

    navigate.mockClear();
    click(button('Expand all')!);
    const [knownRow, unknownRow] = contractRows();

    click(unknownRow);                               // NOMATCH isn't in the customer list → nowhere to go
    expect(navigate).not.toHaveBeenCalled();

    click(knownRow);
    expect(navigate).toHaveBeenCalledWith(['/'], { queryParams: { customerId: 42 } });
  });

  // ── Usage tracking ────────────────────────────────────────────────────────

  it('logs a search once the user stops typing (800 ms), trimmed, and never for an emptied box', () => {
    vi.useFakeTimers();
    createPage({ customers: [SAMPLE], contracts: [makeContract()] });

    type('Search by producer...', 'Sam');
    vi.advanceTimersByTime(300);
    type('Search by producer...', 'Sample ');
    vi.advanceTimersByTime(799);
    expect(postClickEvent).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(postClickEvent).toHaveBeenCalledTimes(1);
    expect(postClickEvent).toHaveBeenCalledWith('interaction', 'unshipped-bushels', 'search-customer', 'Sample');

    type('Search by producer...', '');
    vi.advanceTimersByTime(1000);
    type('Filter by commodity...', 'corn');
    vi.advanceTimersByTime(1000);

    expect(postClickEvent).toHaveBeenCalledTimes(2);
    expect(postClickEvent).toHaveBeenLastCalledWith('interaction', 'unshipped-bushels', 'search-commodity', 'corn');
  });
});
