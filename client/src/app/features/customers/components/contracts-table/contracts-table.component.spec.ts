import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef, signal } from '@angular/core';
import { ContractsTableComponent } from './contracts-table.component';
import { AppStateService } from '@core/services/app-state.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { CommodityConversion, Contract, ContractPricingLine, Customer, Ticket } from '@models';

// Behaviour safety net for the per-row derivations (applied tickets, pricing status, delivery
// stats, calculated status), the row sort, the search filter, the commodity grouping, the
// expanded-row pricing lines and the optional fulfillment columns. Everything is driven through
// the signal inputs, the public methods the template calls, and the rendered DOM — so the
// internals (caches, change detection strategy) can change underneath without touching this file.
//
// The component is purely input-driven: it injects no ApiService, so there is nothing to stub
// with of(...). The parent page fetches contracts / tickets / pricing lines and hands them in.

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** The clock is frozen here (Date only — timers stay real) so Past Due / Active / To Arrive and
 *  the month-name search never drift as the calendar moves on. */
const NOW = new Date('2026-10-13T12:00:00');

const DAY = 24 * 60 * 60 * 1000;
/** Noon local time N days from the frozen "now" — a whole-day offset that can't straddle midnight in any TZ. */
function daysFromNow(n: number): Date {
  const d = new Date(NOW.getTime() + n * DAY);
  d.setHours(12, 0, 0, 0);
  return d;
}

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 42, scoularId: 'SAMPFRM', name: 'Sample Farms', farm: 'Sample Farms', location: 'Pratt, KS',
    phone: '', email: '', totalAcres: 0, linkedProducerIds: [], eSignEnabled: false, achEnabled: false, ...over,
  };
}

/** An open, signed, unpriced 10,000 BU corn contract in the middle of its delivery window. */
function makeContract(over: Partial<Contract> = {}): Contract {
  return {
    id: 1,
    customerId: 42,
    ctrmCustomerId: 'SAMPFRM',
    sourceContractId: 'PCW100',
    farmId: 'F1',
    contractNumber: '100',
    contractPrefixType: 'P',
    commodityCode: 'YC',
    commodityDescription: 'Corn',
    commodityGroup: 'Corn',
    quantity: 10000,
    unit: 'bushels',
    price: 0,
    contractDate: new Date('2026-03-15T12:00:00'),
    openBalanceQuantity: 10000,
    settledQuantity: 0,
    deliveryStart: daysFromNow(-30),
    deliveryEnd: daysFromNow(30),
    status: 'Active',
    signed: true,
    priceTypeCode: 'U',
    ...over,
  };
}

/** An applied ticket on PCW100. */
function makeTicket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    farmId: 'F1',
    ticketNumber: '500',
    ctrmContractNumber: 'PCW100',
    date: '2026-04-10',
    grossWeight: 60000,
    tareWeight: 4000,
    netWeight: 56000,
    isApplied: true,
    isActive: true,
    ...over,
  };
}

function makeLine(over: Partial<ContractPricingLine> = {}): ContractPricingLine {
  return { contractId: 'PCW100', priceSequence: 1, priceQuantity: 5000, ...over };
}

// ── Harness ───────────────────────────────────────────────────────────────────

describe('ContractsTableComponent', () => {
  let fixture: ComponentFixture<ContractsTableComponent>;
  let component: ContractsTableComponent;
  let ref: ComponentRef<ContractsTableComponent>;
  let trackContractExpand: ReturnType<typeof vi.fn>;
  const commodityConversions = signal<CommodityConversion[]>([]);

  function setInputs(inputs: {
    contracts?: Contract[]; tickets?: Ticket[]; pricingLines?: ContractPricingLine[];
    isLoading?: boolean; loadError?: string | null; pricingLoadError?: string | null;
    isLoadingPricingLines?: boolean; isLoadingTickets?: boolean; openContractId?: number | null;
  }): void {
    for (const [name, value] of Object.entries(inputs)) ref.setInput(name, value);
    fixture.detectChanges();
  }

  /** Re-render after calling a toggle method directly. A real click marks the view dirty on its
   *  way through Angular's event listener; a direct call doesn't, and the zoneless TestBed only
   *  refreshes dirty views — so mark it ourselves, exactly as the DOM path would. */
  function render(): void {
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  }

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => host().textContent ?? '';
  /** Body rows only — the header row lives in <thead>. */
  const bodyRows = (): HTMLTableRowElement[] => Array.from(host().querySelectorAll('tbody tr'));
  const columnHeaders = (): string[] => Array.from(host().querySelectorAll('thead th')).map(th => (th.textContent ?? '').trim());

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    trackContractExpand = vi.fn();
    commodityConversions.set([]);
    await TestBed.configureTestingModule({
      imports: [ContractsTableComponent],
      providers: [
        { provide: AppStateService, useValue: { commodityConversions } },
        { provide: UsageTrackingService, useValue: { trackContractExpand } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ContractsTableComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    ref.setInput('customer', makeCustomer());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── getAppliedTickets ─────────────────────────────────────────────────────

  describe('getAppliedTickets', () => {
    it('returns only applied tickets whose CTRM contract number matches the contract, oldest first', () => {
      const contract = makeContract({ id: 1, sourceContractId: 'PCW100' });
      setInputs({
        contracts: [contract, makeContract({ id: 2, sourceContractId: 'PCW200' })],
        tickets: [
          makeTicket({ id: 10, ticketNumber: '1000', date: '2026-04-12' }),
          makeTicket({ id: 11, ticketNumber: '999', date: '2026-04-12' }),          // same day → by number
          makeTicket({ id: 12, ticketNumber: '5', date: '2026-04-01' }),            // earliest
          makeTicket({ id: 13, ctrmContractNumber: ' PCW100 ' }),                   // whitespace is trimmed
          makeTicket({ id: 14, ctrmContractNumber: 'PCW200' }),                     // other contract
          makeTicket({ id: 15, ctrmContractNumber: 'UNL100', isApplied: false }),   // unload: not applied
          makeTicket({ id: 16, isApplied: false }),                                 // matches but unapplied
        ],
      });

      expect(component.getAppliedTickets(contract).map(t => t.id)).toEqual([12, 13, 11, 10]);
    });

    it('falls back to the contractId FK when the ticket carries no CTRM contract number', () => {
      const contract = makeContract({ id: 7, sourceContractId: 'PCW700' });
      setInputs({
        contracts: [contract],
        tickets: [
          makeTicket({ id: 1, ctrmContractNumber: undefined, contractId: 7 }),
          makeTicket({ id: 2, ctrmContractNumber: undefined, contractId: 8 }),
          makeTicket({ id: 3, ctrmContractNumber: undefined, contractId: undefined }),
        ],
      });

      expect(component.getAppliedTickets(contract).map(t => t.id)).toEqual([1]);
    });

    it('returns nothing for a contract with no applied tickets', () => {
      const contract = makeContract({ id: 1, sourceContractId: 'PCW100' });
      setInputs({ contracts: [contract], tickets: [makeTicket({ ctrmContractNumber: 'PCW999' })] });

      expect(component.getAppliedTickets(contract)).toEqual([]);
    });
  });

  // ── getPricingInfo / getPricingLinesForContract ───────────────────────────

  describe('getPricingInfo', () => {
    it('derives the status from the price type code and the contract\'s pricing lines', () => {
      const unpriced = makeContract({ id: 1, sourceContractId: 'PCW1', priceTypeCode: 'U' });
      const partial = makeContract({ id: 2, sourceContractId: 'PCW2', priceTypeCode: 'U', quantity: 25000 });
      const priced = makeContract({ id: 3, sourceContractId: 'PCW3', priceTypeCode: 'U', quantity: 25000 });
      const cash = makeContract({ id: 4, sourceContractId: 'PCW4', priceTypeCode: 'P' });
      const flatNoLine = makeContract({ id: 5, sourceContractId: 'PCW5', priceTypeCode: 'p ' }); // case/space tolerant
      const deferred = makeContract({ id: 6, sourceContractId: 'PCW6', priceTypeCode: 'D' });
      const noCode = makeContract({ id: 7, sourceContractId: 'PCW7', priceTypeCode: undefined });
      setInputs({
        contracts: [unpriced, partial, priced, cash, flatNoLine, deferred, noCode],
        pricingLines: [
          makeLine({ contractId: 'PCW2', priceSequence: 0, priceQuantity: 0 }),      // placeholder
          makeLine({ contractId: 'PCW2', priceSequence: 1, priceQuantity: 5000 }),
          makeLine({ contractId: 'PCW3', priceSequence: 1, priceQuantity: 20000 }),
          makeLine({ contractId: 'PCW3', priceSequence: 2, priceQuantity: 4999.5 }), // within 1 BU → PRICED
          makeLine({ contractId: 'PCW4', priceSequence: 1, priceQuantity: 10000, flatPrice: 4.255 }),
        ],
      });

      expect(component.getPricingInfo(unpriced)).toEqual({ status: 'UNPRICED' });
      expect(component.getPricingInfo(partial)).toEqual({ status: 'PARTIAL' });
      expect(component.getPricingInfo(priced)).toEqual({ status: 'PRICED' });
      expect(component.getPricingInfo(cash)).toEqual({ status: 'FLAT', cashPrice: 4.255 });
      expect(component.getPricingInfo(flatNoLine)).toEqual({ status: 'PRICED' });
      expect(component.getPricingInfo(deferred)).toEqual({ status: 'DEFERRED' });
      expect(component.getPricingInfo(noCode)).toEqual({ status: 'UNPRICED' });
    });

    it('surfaces a locked-in basis on a single-line unpriced contract, but not a zero basis or several lines', () => {
      const oneLine = makeContract({ id: 1, sourceContractId: 'PCW1', priceTypeCode: 'U' });
      const zeroBasis = makeContract({ id: 2, sourceContractId: 'PCW2', priceTypeCode: 'U' });
      const twoLines = makeContract({ id: 3, sourceContractId: 'PCW3', priceTypeCode: 'U' });
      setInputs({
        contracts: [oneLine, zeroBasis, twoLines],
        pricingLines: [
          makeLine({ contractId: 'PCW1', priceSequence: 0, priceQuantity: 0, basisPrice: -0.35 }),
          makeLine({ contractId: 'PCW2', priceSequence: 0, priceQuantity: 0, basisPrice: 0 }),
          makeLine({ contractId: 'PCW3', priceSequence: 0, priceQuantity: 0, basisPrice: -0.35 }),
          makeLine({ contractId: 'PCW3', priceSequence: 0, priceQuantity: 0, basisPrice: -0.40 }),
        ],
      });

      expect(component.getPricingInfo(oneLine)).toEqual({ status: 'UNPRICED', basisPrice: -0.35 });
      expect(component.getPricingInfo(zeroBasis)).toEqual({ status: 'UNPRICED' });
      expect(component.getPricingInfo(twoLines)).toEqual({ status: 'UNPRICED' });
    });

    it('looks pricing lines up by source contract id and gives an unkeyed contract none', () => {
      const keyed = makeContract({ id: 1, sourceContractId: 'PCW1' });
      const unkeyed = makeContract({ id: 2, sourceContractId: undefined, priceTypeCode: 'P' });
      setInputs({
        contracts: [keyed, unkeyed],
        pricingLines: [
          makeLine({ contractId: 'PCW1', priceSequence: 1 }),
          makeLine({ contractId: 'PCW1', priceSequence: 2 }),
          makeLine({ contractId: 'PCW9', priceSequence: 1 }),
        ],
      });

      expect(component.getPricingLinesForContract(keyed).map(l => l.priceSequence)).toEqual([1, 2]);
      expect(component.getPricingLinesForContract(unkeyed)).toEqual([]);
      expect(component.getPricingInfo(unkeyed)).toEqual({ status: 'PRICED' });
    });
  });

  // ── getDeliveryStats / getCalculatedStatus ────────────────────────────────

  describe('getDeliveryStats', () => {
    it('reports delivered / remaining / progress from the open balance', () => {
      const partlyDelivered = makeContract({ id: 1, quantity: 10000, openBalanceQuantity: 4000 });
      const untouched = makeContract({ id: 2, quantity: 10000, openBalanceQuantity: 10000 });
      const unknown = makeContract({ id: 3, quantity: 10000, openBalanceQuantity: undefined });
      const done = makeContract({ id: 4, quantity: 10000, openBalanceQuantity: 0 });
      setInputs({ contracts: [partlyDelivered, untouched, unknown, done] });

      expect(component.getDeliveryStats(partlyDelivered)).toEqual({ deliveredBushels: 6000, remainingBushels: 4000, progressPercent: 60, computable: true });
      expect(component.getDeliveryStats(untouched)).toEqual({ deliveredBushels: 0, remainingBushels: 10000, progressPercent: 0, computable: true });
      // CTRM hasn't populated the aggregate yet: assume nothing delivered rather than filing it as done.
      expect(component.getDeliveryStats(unknown)).toEqual({ deliveredBushels: 0, remainingBushels: 10000, progressPercent: 0, computable: true });
      expect(component.getDeliveryStats(done)).toEqual({ deliveredBushels: 10000, remainingBushels: 0, progressPercent: 100, computable: true });
    });

    it('recomputes when the contracts input changes', () => {
      setInputs({ contracts: [makeContract({ id: 1, openBalanceQuantity: 4000 })] });
      expect(component.getDeliveryStats(component.contracts()[0]).deliveredBushels).toBe(6000);

      setInputs({ contracts: [makeContract({ id: 1, openBalanceQuantity: 1000 })] });
      expect(component.getDeliveryStats(component.contracts()[0]).deliveredBushels).toBe(9000);
    });
  });

  describe('getCalculatedStatus', () => {
    it('derives Filled / Cancelled / Past Due / Active / To Arrive', () => {
      const filled = makeContract({ id: 1, openBalanceQuantity: 0 });
      const residue = makeContract({ id: 2, quantity: 10000, openBalanceQuantity: 5 }); // < 0.1% → Filled
      const cancelled = makeContract({ id: 3, status: 'Cancelled' });
      const pastDue = makeContract({ id: 4, deliveryStart: daysFromNow(-60), deliveryEnd: daysFromNow(-1) });
      const active = makeContract({ id: 5 });
      const toArrive = makeContract({ id: 6, deliveryStart: daysFromNow(1), deliveryEnd: daysFromNow(60) });
      const filledPastDue = makeContract({ id: 7, openBalanceQuantity: 0, deliveryEnd: daysFromNow(-1) });
      setInputs({ contracts: [filled, residue, cancelled, pastDue, active, toArrive, filledPastDue] });

      expect(component.getCalculatedStatus(filled)).toBe('Filled');
      expect(component.getCalculatedStatus(residue)).toBe('Filled');
      expect(component.getCalculatedStatus(cancelled)).toBe('Cancelled');
      expect(component.getCalculatedStatus(pastDue)).toBe('Past Due');
      expect(component.getCalculatedStatus(active)).toBe('Active');
      expect(component.getCalculatedStatus(toArrive)).toBe('To Arrive');
      expect(component.getCalculatedStatus(filledPastDue)).toBe('Filled'); // delivered wins over the date
    });
  });

  // ── Sorting ───────────────────────────────────────────────────────────────

  describe('sorting', () => {
    const corn = (id: number, over: Partial<Contract>) => makeContract({ id, sourceContractId: `PCW${id}`, ...over });

    it('orders by delivery start (soonest first) when no column is active', () => {
      setInputs({ contracts: [
        corn(1, { deliveryStart: daysFromNow(-10) }),
        corn(2, { deliveryStart: daysFromNow(-30) }),
        corn(3, { deliveryStart: daysFromNow(-20) }),
      ] });

      expect(component.currentSortColumn()).toBeNull();
      expect(component.displayedContracts().map(c => c.id)).toEqual([2, 3, 1]);
    });

    it('cycles a column through asc → desc → off and reports the active column via getSortIconClass', () => {
      setInputs({ contracts: [corn(1, { quantity: 5000 }), corn(2, { quantity: 20000 }), corn(3, { quantity: 10000 })] });
      const ids = () => component.displayedContracts().map(c => c.id);
      const inactive = component.getSortIconClass('quantity');

      component.handleSort('quantity');
      expect(component.currentSortDirection()).toBe('asc');
      expect(ids()).toEqual([1, 3, 2]);
      expect(component.getSortIconClass('quantity')).not.toBe(inactive);
      expect(component.getSortIconClass('date')).toBe(inactive);

      component.handleSort('quantity');
      expect(component.currentSortDirection()).toBe('desc');
      expect(ids()).toEqual([2, 3, 1]);

      component.handleSort('quantity');
      expect(component.currentSortColumn()).toBeNull();
      expect(component.currentSortDirection()).toBe('none');
      expect(component.getSortIconClass('quantity')).toBe(inactive);

      // Switching columns starts the new one ascending.
      component.handleSort('quantity');
      component.handleSort('date');
      expect(component.currentSortColumn()).toBe('date');
      expect(component.currentSortDirection()).toBe('asc');
    });

    it('sorts contract numbers by letter prefix, then numerically within the prefix', () => {
      setInputs({ contracts: [
        makeContract({ id: 1, sourceContractId: 'PCY1' }),
        makeContract({ id: 2, sourceContractId: 'PCW10' }),
        makeContract({ id: 3, sourceContractId: 'PCW9' }),
      ] });

      component.handleSort('contractNumber');
      expect(component.displayedContracts().map(c => c.sourceContractId)).toEqual(['PCW9', 'PCW10', 'PCY1']);
    });

    it('ranks the Price column Deferred → Unpriced → Partial → Priced → cash price', () => {
      const cash = makeContract({ id: 1, sourceContractId: 'PCW1', priceTypeCode: 'P' });
      const priced = makeContract({ id: 2, sourceContractId: 'PCW2', priceTypeCode: 'P' });
      const partial = makeContract({ id: 3, sourceContractId: 'PCW3', priceTypeCode: 'U', quantity: 10000 });
      const unpriced = makeContract({ id: 4, sourceContractId: 'PCW4', priceTypeCode: 'U' });
      const deferred = makeContract({ id: 5, sourceContractId: 'PCW5', priceTypeCode: 'D' });
      setInputs({
        contracts: [cash, priced, partial, unpriced, deferred],
        pricingLines: [
          makeLine({ contractId: 'PCW1', flatPrice: 4.5 }),
          makeLine({ contractId: 'PCW3', priceSequence: 1, priceQuantity: 2000 }),
        ],
      });

      component.handleSort('price');
      expect(component.displayedContracts().map(c => c.id)).toEqual([5, 4, 3, 2, 1]);
    });

    it('clicking a column header in the DOM sorts the rendered rows', () => {
      setInputs({ contracts: [corn(1, { quantity: 5000 }), corn(2, { quantity: 20000 }), corn(3, { quantity: 10000 })] });
      const quantityHeader = Array.from(host().querySelectorAll('thead th')).find(th => th.textContent?.includes('Quantity')) as HTMLElement;

      quantityHeader.click();
      fixture.detectChanges();

      expect(bodyRows().map(r => r.id)).toEqual(['contract-row-1', 'contract-row-3', 'contract-row-2']);
      quantityHeader.click();
      fixture.detectChanges();
      expect(bodyRows().map(r => r.id)).toEqual(['contract-row-2', 'contract-row-3', 'contract-row-1']);
    });
  });

  // ── Search ────────────────────────────────────────────────────────────────

  describe('searchQuery', () => {
    // Two next-year contracts (To Arrive) and one whose window closed yesterday (Past Due).
    const contracts = () => [
      makeContract({ id: 1, sourceContractId: 'PCW100', commodityCode: 'YC', commodityDescription: 'Corn', deliveryStart: new Date('2027-06-01T12:00:00'), deliveryEnd: new Date('2027-08-31T12:00:00') }),
      makeContract({ id: 2, sourceContractId: 'PCS200', commodityCode: 'SG', commodityDescription: 'Sorghum', commodityGroup: 'Sorghum', deliveryStart: new Date('2027-10-01T12:00:00'), deliveryEnd: new Date('2027-11-30T12:00:00') }),
      makeContract({ id: 3, sourceContractId: 'PCB300', commodityCode: 'YSB', commodityDescription: 'Soybeans', commodityGroup: 'Soybeans', deliveryStart: daysFromNow(-60), deliveryEnd: daysFromNow(-1) }),
    ];
    const ids = () => component.displayedContracts().map(c => c.id);

    it('matches contract number, commodity and calculated status, case-insensitively', () => {
      setInputs({ contracts: contracts() });

      component.searchQuery.set('pcs2');
      expect(ids()).toEqual([2]);
      component.searchQuery.set('CORN');
      expect(ids()).toEqual([1]);
      component.searchQuery.set('past due');
      expect(ids()).toEqual([3]);
    });

    it('expands commodity aliases so "milo" finds sorghum and "beans" finds soybeans', () => {
      setInputs({ contracts: contracts() });

      component.searchQuery.set('milo');
      expect(ids()).toEqual([2]);
      component.searchQuery.set('beans');
      expect(ids()).toEqual([3]);
    });

    it('matches a month that falls inside the delivery period', () => {
      setInputs({ contracts: contracts() });

      component.searchQuery.set('july'); // only contract 1 (Jun–Aug) spans July
      expect(ids()).toEqual([1]);
      component.searchQuery.set('11/30/2027');
      expect(ids()).toEqual([2]);
    });

    it('renders a "no match" message and clears the query when the customer changes', () => {
      setInputs({ contracts: contracts() });

      component.searchQuery.set('canola');
      fixture.detectChanges();
      expect(ids()).toEqual([]);
      expect(bodyRows()).toHaveLength(0);
      expect(text()).toContain('No contracts match "canola"');

      ref.setInput('customer', makeCustomer({ id: 99 }));
      fixture.detectChanges();
      expect(component.searchQuery()).toBe('');
      expect(bodyRows()).toHaveLength(3);
    });
  });

  // ── Grouping ──────────────────────────────────────────────────────────────

  describe('groupedContracts', () => {
    it('buckets open contracts by commodity code (falling back to description), alphabetically, with closed ones dropped', () => {
      setInputs({ contracts: [
        makeContract({ id: 1, sourceContractId: 'PCW1', commodityCode: 'YSB', commodityDescription: 'Soybeans' }),
        makeContract({ id: 2, sourceContractId: 'PCW2', commodityCode: 'YC', commodityDescription: 'Corn' }),
        makeContract({ id: 3, sourceContractId: 'PCW3', commodityCode: 'YC', commodityDescription: 'Yellow Corn #2' }), // same code → same bucket
        makeContract({ id: 4, sourceContractId: 'PCW4', commodityCode: undefined, commodityDescription: 'Milo' }),
        makeContract({ id: 5, sourceContractId: 'PCW5', commodityCode: 'YC', closedDate: new Date('2026-01-01') }),       // closed: never shown
      ] });

      expect(component.groupedContracts().map(g => [g.commodity, g.contracts.map(c => c.id)])).toEqual([
        ['Milo', [4]],
        ['YC', [2, 3]],
        ['YSB', [1]],
      ]);
      expect(component.openContracts.map(c => c.id)).not.toContain(5);
    });

    it('the Crop header flips the group order without touching the row sort', () => {
      setInputs({ contracts: [
        makeContract({ id: 1, sourceContractId: 'PCW1', commodityCode: 'YSB' }),
        makeContract({ id: 2, sourceContractId: 'PCW2', commodityCode: 'YC' }),
      ] });
      component.handleSort('quantity');

      component.handleSort('crop');

      expect(component.groupSortDirection()).toBe('desc');
      expect(component.groupedContracts().map(g => g.commodity)).toEqual(['YSB', 'YC']);
      expect(component.currentSortColumn()).toBe('quantity');
      expect(component.getSortIconClass('crop')).toBe(component.getSortIconClass('date')); // never the "active" class
    });

    it('a Delivery Period sort collapses the groups into one flat, delivery-ordered list', () => {
      setInputs({ contracts: [
        makeContract({ id: 1, sourceContractId: 'PCW1', commodityCode: 'YSB', deliveryStart: daysFromNow(-5) }),
        makeContract({ id: 2, sourceContractId: 'PCW2', commodityCode: 'YC', deliveryStart: daysFromNow(-25) }),
        makeContract({ id: 3, sourceContractId: 'PCW3', commodityCode: 'YSB', deliveryStart: daysFromNow(-15) }),
      ] });

      component.handleSort('deliveryStart');
      expect(component.groupedContracts()).toHaveLength(1);
      expect(component.groupedContracts()[0].contracts.map(c => c.id)).toEqual([2, 3, 1]);

      component.handleSort('deliveryStart');
      component.handleSort('deliveryStart'); // off again → grouping returns
      expect(component.groupedContracts().map(g => g.commodity)).toEqual(['YC', 'YSB']);
    });
  });

  // ── Rendering ─────────────────────────────────────────────────────────────

  describe('rendering', () => {
    it('shows one row per open contract with its contract id, pricing badge and calculated status', () => {
      const partial = makeContract({ id: 1, sourceContractId: 'PCW1', priceTypeCode: 'U', quantity: 10000 });
      const cash = makeContract({ id: 2, sourceContractId: 'PCW2', priceTypeCode: 'P', unit: 'bushels', deliveryStart: daysFromNow(5), deliveryEnd: daysFromNow(40) });
      const deferred = makeContract({ id: 3, sourceContractId: 'PCW3', priceTypeCode: 'D', deliveryStart: daysFromNow(-40), deliveryEnd: daysFromNow(-2) });
      setInputs({
        contracts: [partial, cash, deferred],
        pricingLines: [
          makeLine({ contractId: 'PCW1', priceSequence: 1, priceQuantity: 2500 }),
          makeLine({ contractId: 'PCW2', priceSequence: 1, priceQuantity: 10000, flatPrice: 4.25 }),
        ],
      });

      const rows = bodyRows();
      expect(rows).toHaveLength(3);
      const rowText = (id: number) => rows.find(r => r.id === `contract-row-${id}`)?.textContent?.replace(/\s+/g, ' ') ?? '';
      expect(rowText(1)).toContain('PCW1');
      expect(rowText(1)).toContain('Partial');
      expect(rowText(1)).toContain('Active');
      expect(rowText(2)).toContain('$4.25/bushel');
      expect(rowText(2)).toContain('To Arrive');
      expect(rowText(3)).toContain('Deferred');
      expect(rowText(3)).toContain('Past Due');
    });

    it('shows the empty state when the producer has no open contracts', () => {
      setInputs({ contracts: [makeContract({ closedDate: new Date('2026-01-01') })] });
      expect(text()).toContain('No contracts found for this producer');
      expect(host().querySelector('table')).toBeNull();
    });

    it('shows the loading spinner text and, on a failed read, the error with a Retry that asks the parent to reload', () => {
      const retries = vi.fn();
      component.retryLoad.subscribe(retries);

      setInputs({ contracts: [makeContract()], isLoading: true });
      expect(text()).toContain('Loading contracts...');
      expect(bodyRows()).toHaveLength(0);

      setInputs({ isLoading: false, loadError: 'CTRM timed out' });
      expect(text()).toContain('Contracts could not be loaded');
      expect(text()).toContain('CTRM timed out');
      expect(text()).not.toContain('No contracts found');
      (host().querySelector('button') as HTMLButtonElement).click();
      expect(retries).toHaveBeenCalledTimes(1);
    });

    it('clicking a row expands it and the pricing section lists that contract\'s lines', () => {
      const contract = makeContract({ id: 1, sourceContractId: 'PCW1', priceTypeCode: 'U', quantity: 10000, openBalanceQuantity: 4000 });
      setInputs({
        contracts: [contract],
        pricingLines: [
          makeLine({ contractId: 'PCW1', priceSequence: 1, priceQuantity: 2500, flatPrice: 4.1, customerConfirmStatus: 'Confirmed' }),
          makeLine({ contractId: 'PCW1', priceSequence: 2, priceQuantity: 1500, flatPrice: 4.2 }),
          makeLine({ contractId: 'PCW9', priceSequence: 1 }),
        ],
      });
      expect(text()).not.toContain('Delivery Progress');

      bodyRows()[0].click();
      fixture.detectChanges();

      expect(bodyRows()).toHaveLength(2); // main row + detail row
      expect(text()).toContain('Delivery Progress');
      expect(text().replace(/\s+/g, ' ')).toContain('Pricing Lines (2)');
      expect(text().replace(/\s+/g, ' ')).toContain('6,000 bushels delivered');
      expect(trackContractExpand).toHaveBeenCalledWith('PCW1');

      component.togglePricingSection(1);
      render();
      const lineRows = Array.from(host().querySelectorAll('tbody tbody tr'));
      expect(lineRows).toHaveLength(2);
      expect(lineRows[0].textContent?.replace(/\s+/g, ' ')).toContain('$4.10');
      expect(lineRows[0].textContent).toContain('Confirmed');
      expect(lineRows[1].textContent?.replace(/\s+/g, ' ')).toContain('$4.20');

      bodyRows()[0].click();
      fixture.detectChanges();
      expect(bodyRows()).toHaveLength(1);
    });

    it('renders the pricing-lines loading and error states instead of a misleading "(0)"', () => {
      const contract = makeContract({ id: 1, sourceContractId: 'PCW1' });
      setInputs({ contracts: [contract], isLoadingPricingLines: true });
      component.toggleRow(1);
      component.togglePricingSection(1);
      render();
      const pricingHeader = () => Array.from(host().querySelectorAll('button')).find(b => b.textContent?.includes('Pricing Lines'))?.textContent?.replace(/\s+/g, ' ') ?? '';
      expect(pricingHeader()).toContain('(Loading…)');
      expect(text()).toContain('Loading pricing lines…');

      setInputs({ isLoadingPricingLines: false, pricingLoadError: 'GraphQL 502' });
      expect(pricingHeader()).toContain('(unavailable)');
      expect(pricingHeader()).not.toContain('(0)');
      expect(text()).toContain('Pricing lines could not be loaded from CTRM');
      expect(text()).toContain('GraphQL 502');
    });

    it('the Applied Tickets section waits for the ticket read and then lists the tickets', () => {
      const contract = makeContract({ id: 1, sourceContractId: 'PCW1' });
      setInputs({ contracts: [contract], tickets: [], isLoadingTickets: true });
      component.toggleRow(1);
      component.toggleTicketSection(1);
      render();
      expect(text()).toContain('Loading applied tickets…');

      setInputs({ isLoadingTickets: false, tickets: [makeTicket({ ctrmContractNumber: 'PCW1', shipmentTicketNumber: 'T500A' })] });
      expect(text().replace(/\s+/g, ' ')).toContain('Applied Tickets (1)');
      expect(text()).toContain('T500A');

      setInputs({ tickets: [] });
      expect(text()).toContain('No tickets applied to this contract yet.');
    });

    it('a deep-linked openContractId arrives already expanded', () => {
      setInputs({ contracts: [makeContract({ id: 1 }), makeContract({ id: 2, sourceContractId: 'PCW2' })], openContractId: 2 });

      expect(component.expandedRows.has(2)).toBe(true);
      expect(bodyRows().map(r => r.id)).toEqual(['contract-row-1', 'contract-row-2', '']);
    });
  });

  // ── Extra columns ─────────────────────────────────────────────────────────

  describe('showExtraColumns', () => {
    it('reveals the fulfillment columns with per-row values (em-dash when CTRM has no data) and tells the parent', () => {
      const emitted: boolean[] = [];
      component.expandedColumnsChange.subscribe(v => emitted.push(v));
      setInputs({ contracts: [
        makeContract({ id: 1, sourceContractId: 'PCW1', quantity: 10000, openBalanceQuantity: 4000, settledQuantity: 5000 }),
        makeContract({ id: 2, sourceContractId: 'PCW2', quantity: 10000, openBalanceQuantity: undefined, settledQuantity: undefined }),
      ] });
      expect(columnHeaders()).not.toContain('Remaining Quantity');
      expect(component.detailColspan()).toBe(8);

      component.toggleExtraColumns();
      render();

      expect(columnHeaders().slice(-3)).toEqual(['Remaining Quantity', 'Total Delivered', 'Unsettled Quantity']);
      expect(component.detailColspan()).toBe(11);
      expect(emitted).toEqual([true]);
      const cells = (id: number) => Array.from(bodyRows().find(r => r.id === `contract-row-${id}`)!.querySelectorAll('td')).slice(-3).map(td => (td.textContent ?? '').replace(/\s+/g, ' ').trim());
      expect(cells(1)).toEqual(['4,000.00 bushels', '6,000.00 bushels', '1,000.00 bushels']);
      expect(cells(2)).toEqual(['—', '—', '—']);
    });

    it('hiding the columns drops a sort that was on one of them', () => {
      setInputs({ contracts: [makeContract({ id: 1 })] });
      component.toggleExtraColumns();
      component.handleSort('remaining');
      expect(component.currentSortColumn()).toBe('remaining');

      component.toggleExtraColumns();

      expect(component.showExtraColumns()).toBe(false);
      expect(component.currentSortColumn()).toBeNull();
      expect(component.currentSortDirection()).toBe('none');
    });
  });
});

