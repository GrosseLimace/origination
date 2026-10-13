import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { MsalService } from '@azure/msal-angular';
import { CustomerPrintReportComponent } from './customer-print-report.component';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { Commodity, Contract, ContractPricingLine, Customer, PlantingIntention, StoredGrain, Ticket } from '@models';

// Behaviour safety net for the Producer Summary Report dialog ahead of its OnPush conversion. Pins,
// through the signal inputs, the sidebar checkboxes and the rendered preview:
//   - the banner (contact fallbacks, originator defaults from MSAL) and the KPI tiles (bushel-only
//     Total Contracted, per-tile toggles);
//   - which sections default on when the dialog opens (only those with data), and that reopening
//     re-applies those defaults;
//   - Contracts: open-only, grouped by commodity code (alphabetical) with per-group totals, soonest
//     delivery first, the price label (flat / priced / partial / deferred / unpriced), the derived
//     status (Filled / Cancelled / Past Due / Active / To Arrive) and the delivery window;
//   - pricing lines (sequence 0 hidden, count limited to open contracts, flat table when hidden);
//   - unapplied tickets grouped by product with bushel conversion, quality averages and the
//     wheat-only protein column;
//   - planting intentions by planting category with the crop-year picker;
//   - grain in storage and bin-site groupings;
//   - printReport(): the escaped HTML handed to the print window, and the pop-up-blocked toast.
//
// The real template renders (dialog, button and all). AppStateService is the real one; MSAL and
// ToastService are stubbed. Shared utils (contract-delivery, production-coverage, planting-category,
// grain-on-farm) run for real.

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Frozen clock (Date only) so Past Due / Active / To Arrive and the report date never drift. */
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
    id: 42, scoularId: 'SAMPFRM', name: 'Sample Farms', farm: 'Sample Farm Co', location: 'Pratt',
    stateProvince: 'KS', phone: '316-555-0100', email: 'sample@example.com', totalAcres: 1200,
    linkedProducerIds: [], eSignEnabled: false, achEnabled: false, ...over,
  };
}

/** An open, unpriced 10,000 bu corn contract in the middle of its delivery window. */
function makeContract(over: Partial<Contract> = {}): Contract {
  return {
    id: 1, customerId: 42, ctrmCustomerId: 'SAMPFRM', sourceContractId: 'PCW100', farmId: 'F1',
    contractNumber: '100', contractPrefixType: 'P', commodityCode: 'YC', commodityDescription: 'Corn',
    commodityGroup: 'Corn', quantity: 10000, unit: 'bu', price: 0, openBalanceQuantity: 10000,
    deliveryStart: daysFromNow(-30), deliveryEnd: daysFromNow(30), status: 'Active', signed: true,
    priceTypeCode: 'U', ...over,
  };
}

function makeLine(over: Partial<ContractPricingLine> = {}): ContractPricingLine {
  return { contractId: 'PCW100', priceSequence: 1, priceQuantity: 1000, ...over };
}

/** An unapplied (unload) corn ticket. */
function makeTicket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 1, farmId: 'F1', ticketNumber: '500', productCode: 'YC', date: '2026-09-01', grossWeight: 0,
    tareWeight: 0, netWeight: 0, appliedDockQuantity: 56000, isApplied: false, isActive: true, ...over,
  };
}

function makeIntention(over: Partial<PlantingIntention> = {}): PlantingIntention {
  return {
    id: 1, customerId: 42, customerName: 'Sample Farms', customerCode: 'SAMPFRM', tradeUnit: '2190',
    plantingYear: 2026, crop: 'YC', acres: 500, createdAt: '2026-01-01T00:00:00', createdBy: 'test', ...over,
  };
}

function makeStoredGrain(over: Partial<StoredGrain> = {}): StoredGrain {
  return {
    id: 'R1|L1', receiptNumber: 'R1', customerId: 42, customerCode: 'SAMPFRM', crop: 'Corn', quantity: 1000,
    grossQuantity: 1000, storageStartDate: new Date('2026-08-01T12:00:00'), storageRate: 0.05, bin: 'B1',
    receivableAmount: 50.5, storageDays: 70, chargedFromDate: null, chargedThruDate: null,
    locationCity: 'Pratt', locationState: 'KS', bushels: 1000, dateReceived: new Date('2026-08-01T12:00:00'), ...over,
  };
}

function makeCommodity(over: Partial<Commodity> = {}): Commodity {
  return { id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true, ...over };
}

// ── Harness ───────────────────────────────────────────────────────────────────

describe('CustomerPrintReportComponent', () => {
  let fixture: ComponentFixture<CustomerPrintReportComponent>;
  let component: CustomerPrintReportComponent;
  let ref: ComponentRef<CustomerPrintReportComponent>;
  let appState: AppStateService;
  let toast: { success: ReturnType<typeof vi.fn>; warning: ReturnType<typeof vi.fn> };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  /** The report preview pane (left), as opposed to the settings sidebar (right). */
  const preview = (): HTMLElement => host().querySelector<HTMLElement>('div.bg-white.p-6')!;
  const sidebar = (): HTMLElement => host().querySelector<HTMLElement>('div[class*="lg:w-64"]')!;
  const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
  const previewText = (): string => squash(preview().textContent);

  /** Section headings in the preview, in order (the 12px uppercase accent titles). */
  function sectionTitles(): string[] {
    return Array.from(preview().querySelectorAll<HTMLElement>('div'))
      .filter(d => d.style.textTransform === 'uppercase' && d.style.fontSize === '12px')
      .map(d => squash(d.childNodes[0]?.textContent));
  }
  function section(title: string): HTMLElement {
    const heading = Array.from(preview().querySelectorAll<HTMLElement>('div'))
      .find(d => d.style.textTransform === 'uppercase' && d.style.fontSize === '12px' && squash(d.childNodes[0]?.textContent) === title);
    if (!heading) throw new Error(`section "${title}" not rendered`);
    return heading.parentElement!;
  }
  /** Body rows of a section as arrays of trimmed cell texts. */
  const sectionRows = (title: string): string[][] =>
    Array.from(section(title).querySelectorAll('tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => squash(td.textContent)));
  /** Commodity / crop band headers: [label, "Total: …"]. */
  const bands = (title: string): string[][] =>
    Array.from(section(title).querySelectorAll('span'))
      .filter(s => squash(s.textContent).startsWith('Total:'))
      .map(s => [squash(s.previousElementSibling?.textContent), squash(s.textContent)]);
  /** Contract rows (first cell is the contract id), in render order. */
  const contractRows = (): HTMLTableRowElement[] =>
    Array.from(preview().querySelectorAll<HTMLTableRowElement>('tr'))
      .filter(tr => /^PCW/.test(squash(tr.querySelector('td')?.textContent)));
  const contractCells = (id: string): string[] => {
    const tr = contractRows().find(r => squash(r.querySelector('td')?.textContent) === id);
    if (!tr) throw new Error(`contract ${id} not rendered`);
    return Array.from(tr.querySelectorAll('td')).map(td => squash(td.textContent));
  };
  /** The pricing-line rows printed under a contract (grouped view only). */
  const pricingRows = (id: string): string[][] => {
    const tr = contractRows().find(r => squash(r.querySelector('td')?.textContent) === id)!;
    const card = tr.closest('table')!.parentElement!;
    const linesTable = card.querySelector(':scope > div table');
    return linesTable ? Array.from(linesTable.querySelectorAll('tbody tr')).map(r => Array.from(r.querySelectorAll('td')).map(td => squash(td.textContent))) : [];
  };
  /** KPI tiles as [label, value]. */
  const kpiTiles = (): string[][] => {
    if (!sectionTitles().includes('Executive Summary')) return [];
    return Array.from(section('Executive Summary').querySelectorAll<HTMLElement>('div[style*="grid"] > div'))
      .map(tile => Array.from(tile.children).map(d => squash(d.textContent)));
  };

  /** The report header's right-hand lines (title, date, prepared by, originator title). */
  const headerLines = (): string[] =>
    Array.from(preview().querySelector('img')!.nextElementSibling!.children).map(d => squash(d.textContent));
  /** [name, farm] from the customer banner. */
  const bannerName = (): string[] => {
    const nameDiv = Array.from(preview().querySelectorAll<HTMLElement>('div')).find(d => d.style.fontSize === '20px')!;
    return Array.from(nameDiv.parentElement!.children).map(d => squash(d.textContent));
  };
  /** A banner field's value by its small uppercase label (Location / Phone / Email). */
  const bannerField = (label: string): string | undefined => {
    const lbl = Array.from(preview().querySelectorAll<HTMLElement>('div')).find(d => d.style.fontSize === '9px' && squash(d.textContent) === label);
    return lbl ? squash(lbl.nextElementSibling?.textContent) : undefined;
  };

  /** The sidebar checkbox whose label text matches. */
  function checkbox(label: RegExp): HTMLInputElement {
    const lbl = Array.from(sidebar().querySelectorAll('label')).find(l => label.test(squash(l.textContent)));
    if (!lbl) throw new Error(`no checkbox labelled ${label}`);
    return lbl.querySelector('input')!;
  }
  const checkboxLabel = (label: RegExp): string =>
    squash(Array.from(sidebar().querySelectorAll('label')).find(l => label.test(squash(l.textContent)))?.textContent);
  function setChecked(label: RegExp, checked: boolean): void {
    const box = checkbox(label);
    box.checked = checked;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }
  function click(el: Element | null | undefined): void {
    if (!el) throw new Error('nothing to click');
    (el as HTMLElement).click();
    fixture.detectChanges();
  }

  /** Builds the component with its data inputs, then opens the dialog (the defaults effect fires on open). */
  function open(inputs: {
    customer?: Customer; contracts?: Contract[]; tickets?: Ticket[]; plantingIntentions?: PlantingIntention[];
    storedGrain?: StoredGrain[]; commodities?: Commodity[]; pricingLines?: ContractPricingLine[];
  } = {}): void {
    fixture = TestBed.createComponent(CustomerPrintReportComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    ref.setInput('customer', inputs.customer ?? makeCustomer());
    for (const [name, value] of Object.entries(inputs)) if (name !== 'customer') ref.setInput(name, value);
    ref.setInput('isOpen', true);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    localStorage.clear();
    toast = { success: vi.fn(), warning: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [CustomerPrintReportComponent],
      providers: [
        { provide: ToastService, useValue: toast },
        {
          provide: MsalService,
          // A bare UPN prefix — the dialog completes it to an @scoular.com address.
          useValue: { instance: { getActiveAccount: () => ({ name: 'Caden Egr', username: 'cegr' }), getAllAccounts: () => [] } },
        },
      ],
    }).compileComponents();
    appState = TestBed.inject(AppStateService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Banner, originator, KPIs ──────────────────────────────────────────────

  it('renders nothing while closed, then a banner with contact fallbacks and the signed-in originator', () => {
    fixture = TestBed.createComponent(CustomerPrintReportComponent);
    ref = fixture.componentRef;
    ref.setInput('customer', makeCustomer({ phone: '  ', extendedPrimaryPhone: '316-555-0199', email: '', supplementalEmail: 'alt@example.com' }));
    fixture.detectChanges();
    expect(host().textContent?.trim()).toBe('');

    ref.setInput('isOpen', true);
    fixture.detectChanges();

    expect(headerLines()).toEqual(['Producer Summary Report', 'October 13, 2026', 'Prepared by Caden Egr']);
    expect(bannerName()).toEqual(['Sample Farms', 'Sample Farm Co']);
    expect(bannerField('Location')).toBe('Pratt, KS');
    expect(bannerField('Phone')).toBe('316-555-0199');            // blank phone → extended primary phone
    expect(bannerField('Email')).toBe('alt@example.com');         // blank e-mail → supplemental e-mail
    expect(previewText()).toContain('cegr@scoular.com');          // bare UPN completed to an address in the footer

    const title = Array.from(sidebar().querySelectorAll('input')).find(i => i.placeholder === 'e.g., Grain Originator')!;
    title.value = 'Grain Merchandiser';
    title.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(headerLines()).toEqual(['Producer Summary Report', 'October 13, 2026', 'Prepared by Caden Egr', 'Grain Merchandiser']);

    ref.setInput('customer', makeCustomer({ location: '', stateProvince: undefined, phone: '', extendedPrimaryPhone: undefined }));
    fixture.detectChanges();
    expect(bannerField('Location')).toBe('—');
    expect(bannerField('Phone')).toBeUndefined();                 // no number at all → field dropped
  });

  it('shows Total Acres and a bushels-only Total Contracted, each with its own toggle', () => {
    open({
      contracts: [
        makeContract({ id: 1, sourceContractId: 'PCW100', quantity: 25000, openBalanceQuantity: 25000 }),
        makeContract({ id: 2, sourceContractId: 'PCW200', commodityCode: 'YSB', commodityDescription: 'Soybeans', quantity: 1000, openBalanceQuantity: 1000 }),
        // Soybean meal in short tons with no lb/bu factor: excluded from the bushel KPI, not guessed at.
        makeContract({ id: 3, sourceContractId: 'PCW300', commodityCode: 'SBM', commodityDescription: 'Soybean Meal', quantity: 20, unit: 'ST', openBalanceQuantity: 20 }),
        makeContract({ id: 4, sourceContractId: 'PCW400', quantity: 90000, closedDate: daysFromNow(-5) }),   // closed: ignored
      ],
    });

    expect(kpiTiles()).toEqual([['Total Acres', '1,200'], ['Total Contracted', '26K bu']]);

    setChecked(/^Total Acres$/, false);
    expect(kpiTiles()).toEqual([['Total Contracted', '26K bu']]);

    setChecked(/^Total Contracted$/, false);
    expect(sectionTitles()).not.toContain('Executive Summary');
  });

  // ── Section defaults ──────────────────────────────────────────────────────

  it('defaults every section off when it has nothing to show', () => {
    open({
      customer: makeCustomer({ totalAcres: 0 }),
      contracts: [makeContract({ closedDate: daysFromNow(-1) })],    // only a closed contract
      tickets: [makeTicket({ isApplied: true })],                     // only an applied ticket
    });

    for (const label of [/^Total Acres$/, /^Total Contracted$/, /^Contracts \(/, /^Unapplied Tickets \(/, /^Planting Intentions \(/,
      /^Grain in Storage \(/, /^Bin Sites & Grain on Farm \(/, /^Pricing Lines \(/]) {
      expect(checkbox(label).checked, String(label)).toBe(false);
    }
    expect(checkboxLabel(/^Contracts \(/)).toBe('Contracts (0)');
    expect(checkboxLabel(/^Unapplied Tickets \(/)).toBe('Unapplied Tickets (0)');
    expect(sectionTitles()).toEqual([]);
  });

  it('defaults sections with data on, honours unchecking, and re-applies the defaults when reopened', () => {
    open({
      contracts: [makeContract()],
      tickets: [makeTicket()],
      plantingIntentions: [makeIntention()],
      storedGrain: [makeStoredGrain()],
      commodities: [makeCommodity()],
      customer: makeCustomer({ binSites: [{ siteKey: 's1', name: 'North bins' }], grainOnFarm: [] }),
    });

    expect(sectionTitles()).toEqual(['Executive Summary', 'Contracts', 'Unapplied Tickets', 'Planting Intentions', 'Grain in Storage', 'Bin Sites & Grain on Farm']);
    expect(checkbox(/^Pricing Lines \(/).checked).toBe(false);    // no pricing lines → off

    setChecked(/^Contracts \(/, false);
    setChecked(/^Grain in Storage \(/, false);
    expect(sectionTitles()).toEqual(['Executive Summary', 'Unapplied Tickets', 'Planting Intentions', 'Bin Sites & Grain on Farm']);

    ref.setInput('isOpen', false);
    fixture.detectChanges();
    ref.setInput('isOpen', true);
    fixture.detectChanges();
    expect(sectionTitles()).toContain('Contracts');
    expect(sectionTitles()).toContain('Grain in Storage');
  });

  // ── Contracts ─────────────────────────────────────────────────────────────

  describe('contracts', () => {
    const contracts = (): Contract[] => [
      makeContract({ id: 1, sourceContractId: 'PCW100', quantity: 10000, openBalanceQuantity: 10000, priceTypeCode: 'U' }),
      makeContract({ id: 2, sourceContractId: 'PCW200', quantity: 5000, openBalanceQuantity: 5000, priceTypeCode: 'P', deliveryStart: daysFromNow(10), deliveryEnd: daysFromNow(60) }),
      makeContract({ id: 3, sourceContractId: 'PCW300', commodityCode: 'HRW', commodityDescription: 'Hard Red Winter Wheat', quantity: 8000, openBalanceQuantity: 3000, priceTypeCode: 'D', deliveryStart: daysFromNow(-90), deliveryEnd: daysFromNow(-10) }),
      makeContract({ id: 4, sourceContractId: 'PCW400', commodityCode: 'YSB', commodityDescription: 'Soybeans', quantity: 6000, openBalanceQuantity: 0, priceTypeCode: 'P', deliveryStart: daysFromNow(-120), deliveryEnd: daysFromNow(-60) }),
      makeContract({ id: 5, sourceContractId: 'PCW500', commodityCode: 'YSB', commodityDescription: 'Soybeans', quantity: 4000, openBalanceQuantity: 4000, priceTypeCode: 'U', status: 'Cancelled', deliveryStart: daysFromNow(-5), deliveryEnd: daysFromNow(5) }),
      makeContract({ id: 6, sourceContractId: 'PCW600', quantity: 99999, closedDate: daysFromNow(-3) }),
      makeContract({ id: 7, sourceContractId: 'PCW700', quantity: 3000, openBalanceQuantity: 3000, priceTypeCode: 'U', deliveryStart: daysFromNow(-60), deliveryEnd: daysFromNow(15) }),
    ];
    const lines = (): ContractPricingLine[] => [
      makeLine({ contractId: 'PCW200', priceSequence: 0, priceQuantity: 0, flatPrice: 4.25 }),     // placeholder: price only
      makeLine({ contractId: 'PCW500', priceSequence: 1, priceQuantity: 1000, hedgePrice: 4.1, basisPrice: -0.35, priceDate: '2026-09-15', customerConfirmStatus: 'Confirmed' }),
      makeLine({ contractId: 'PCW700', priceSequence: 1, priceQuantity: 2000, flatPrice: 4.5 }),
      makeLine({ contractId: 'PCW700', priceSequence: 2, priceQuantity: 1000 }),
      makeLine({ contractId: 'PCW600', priceSequence: 1, priceQuantity: 500 }),                    // closed contract's line
    ];

    it('lists open contracts only, banded by commodity code (alphabetical) with totals, soonest delivery first', () => {
      open({ contracts: contracts() });

      expect(checkboxLabel(/^Contracts \(/)).toBe('Contracts (6)');
      expect(bands('Contracts')).toEqual([
        ['Hard Red Winter Wheat', 'Total: 8,000 bu'],
        ['Corn', 'Total: 18,000 bu'],
        ['Soybeans', 'Total: 10,000 bu'],
      ]);
      expect(contractRows().map(r => squash(r.querySelector('td')?.textContent)))
        .toEqual(['PCW300', 'PCW700', 'PCW100', 'PCW200', 'PCW400', 'PCW500']);
    });

    it('labels each contract\'s price and derived status, and formats the delivery window', () => {
      open({ contracts: contracts(), pricingLines: lines() });

      // [price, status]
      const priceAndStatus = (id: string) => { const c = contractCells(id); return [c[2], c[6]]; };
      expect(priceAndStatus('PCW100')).toEqual(['Unpriced', 'Active']);
      expect(priceAndStatus('PCW200')).toEqual(['$4.25', 'To Arrive']);       // P + sequence-0 flat price
      expect(priceAndStatus('PCW300')).toEqual(['Deferred', 'Past Due']);
      expect(priceAndStatus('PCW400')).toEqual(['Priced', 'Filled']);         // zero open balance beats past dates
      expect(priceAndStatus('PCW500')).toEqual(['Partial', 'Cancelled']);
      expect(priceAndStatus('PCW700')).toEqual(['Priced', 'Active']);         // U fully covered by its lines

      const pcw100 = contractCells('PCW100');
      expect(pcw100[1]).toBe('10,000 bu');
      expect(pcw100[3]).toBe('—');                                             // no special type
      expect(pcw100[5]).toBe('Sep 13, 2026 – Nov 12, 2026');
    });

    it('prints pricing lines under their contract (sequence 0 hidden), counts only open contracts\' lines, and goes flat when hidden', () => {
      open({ contracts: contracts(), pricingLines: lines() });

      expect(checkbox(/^Pricing Lines \(/).checked).toBe(true);
      expect(checkboxLabel(/^Pricing Lines \(/)).toBe('Pricing Lines (3)');
      expect(pricingRows('PCW200')).toEqual([]);
      expect(pricingRows('PCW700').map(r => r[0])).toEqual(['1', '2']);
      // Seq, Quantity, Hedge, Basis, Freight Adj, Flat Price, Price Date, Confirm
      expect(pricingRows('PCW500')).toEqual([['1', '1,000 bu', '$4.10', '-$0.35', '—', '—', '9/15/26', 'Confirmed']]);

      setChecked(/^Pricing Lines \(/, false);
      expect(previewText()).not.toContain('Seq');
      expect(contractRows()).toHaveLength(6);
      expect(contractCells('PCW500')[6]).toBe('Cancelled');
    });
  });

  // ── Unapplied tickets ─────────────────────────────────────────────────────

  it('summarises unapplied tickets per product: bushels when convertible, quality averages, wheat-only protein', () => {
    appState.commodityConversions.set([{ commodityCode: 'YC', lbsPerUnit: 56 }]);
    open({
      tickets: [
        makeTicket({ id: 1, productCode: 'YC', appliedDockQuantity: 56000, moisture: 15, testWeight: 56, date: '2026-09-01' }),
        makeTicket({ id: 2, productCode: 'YC', appliedDockQuantity: 112000, moisture: 0, testWeight: 58, date: '2026-09-03' }),
        makeTicket({ id: 3, productCode: 'HRW', appliedDockQuantity: 60000, moisture: 12, testWeight: 60, proteinPercent: 11.5, date: '2026-08-01' }),
        makeTicket({ id: 4, productCode: 'YC', appliedDockQuantity: 999999, isApplied: true }),
      ],
    });

    expect(checkboxLabel(/^Unapplied Tickets \(/)).toBe('Unapplied Tickets (3)');
    expect(section('Unapplied Tickets').querySelectorAll('th')).toHaveLength(7);
    // Crop, # Tickets, Total Net, Avg Date, Avg Moisture, Avg Test Wt, Avg Protein
    expect(sectionRows('Unapplied Tickets')).toEqual([
      ['HRW', '1', '60,000 lbs', 'Aug 1, 2026', '12.0%', '60.0', '11.5%'],     // no conversion → pounds
      ['YC', '2', '3,000 bu', 'Sep 2, 2026', '15.0%', '57.0', '—'],            // zero moisture ignored
    ]);

    ref.setInput('tickets', [makeTicket({ productCode: 'YC' })]);
    fixture.detectChanges();
    expect(section('Unapplied Tickets').querySelectorAll('th')).toHaveLength(6);   // no wheat → no protein column
  });

  // ── Planting intentions ───────────────────────────────────────────────────

  it('groups planting intentions by planting category, and the crop-year picker narrows or drops the section', () => {
    open({
      commodities: [
        makeCommodity({ id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn' }),
        makeCommodity({ id: 2, code: 'YSB', name: 'Yellow Soybeans', category: 'Soybeans' }),
        makeCommodity({ id: 3, code: 'YSBO', name: 'Organic Soybeans', category: 'Soybeans', plantingCategory: 'Organic Soybeans' }),
      ],
      plantingIntentions: [
        makeIntention({ id: 1, crop: 'YC', plantingYear: 2026, acres: 500 }),
        makeIntention({ id: 2, crop: 'YSB', plantingYear: 2026, acres: 300 }),
        makeIntention({ id: 3, crop: 'YC', plantingYear: 2025, acres: 400 }),
        makeIntention({ id: 4, crop: 'YSBO', category: 'Soybeans', plantingYear: 2026, acres: 100 }),   // stored base category defers to the organic label
      ],
    });

    expect(checkboxLabel(/^Planting Intentions \(/)).toBe('Planting Intentions (4)');
    expect(bands('Planting Intentions')).toEqual([
      ['Corn', 'Total: 900 acres'],
      ['Soybeans', 'Total: 300 acres'],
      ['Organic Soybeans', 'Total: 100 acres'],
    ]);
    expect(sectionRows('Planting Intentions')[0]).toEqual(['—', '500', '2026']);   // newest year first

    // The year picker is collapsed until asked for.
    expect(sidebar().textContent).not.toContain('Crop years to include');
    click(sidebar().querySelector('button[aria-label="Choose crop years"]'));
    expect(checkbox(/^2026$/).checked).toBe(true);
    expect(checkbox(/^2025$/).checked).toBe(true);

    setChecked(/^2025$/, false);
    expect(checkboxLabel(/^Planting Intentions \(/)).toBe('Planting Intentions (3)');
    expect(bands('Planting Intentions')[0]).toEqual(['Corn', 'Total: 500 acres']);

    setChecked(/^2026$/, false);
    expect(sidebar().textContent).toContain('No crop years selected');
    expect(sectionTitles()).not.toContain('Planting Intentions');
  });

  // ── Storage and bin sites ─────────────────────────────────────────────────

  it('rolls stored grain up per crop: total bushels, earliest start, longest stay, accumulated cost', () => {
    open({
      storedGrain: [
        makeStoredGrain({ id: 'a', crop: 'Corn', quantity: 1000, receivableAmount: 50.5, storageDays: 70, storageStartDate: new Date('2026-08-01T12:00:00') }),
        makeStoredGrain({ id: 'b', crop: 'Soybeans', quantity: 200, receivableAmount: 0, storageDays: 40, storageStartDate: new Date('2026-09-01T12:00:00') }),
        makeStoredGrain({ id: 'c', crop: 'Corn', quantity: 500, receivableAmount: 20, storageDays: 90, storageStartDate: new Date('2026-07-15T12:00:00') }),
      ],
    });

    expect(checkboxLabel(/^Grain in Storage \(/)).toBe('Grain in Storage (2)');
    expect(sectionRows('Grain in Storage')).toEqual([
      ['Corn', '1,500 bu', 'Jul 15, 2026', '90', '$70.50'],
      ['Soybeans', '200 bu', 'Sep 1, 2026', '40', '$0.00'],
    ]);
  });

  it('bands grain on farm under each bin site in saved order, with an unlinked group and an empty-site placeholder', () => {
    open({
      customer: makeCustomer({
        binSites: [
          { siteKey: 's1', name: 'North bins', capacity: 30000 },
          { siteKey: 's2', name: '  ', capacity: null },
        ],
        grainOnFarm: [
          { binSiteKey: 's1', commodityCode: 'YC', bushelsOnHand: 12000, bushelsSold: 0, targetBushels: 4.5, lastBid: -0.35, grade: ' ' },
          { binSiteKey: null, commodityCode: 'YSB', bushelsOnHand: 3000, bushelsSold: 1000, grade: 'TW 58' },
        ],
      }),
    });

    expect(checkboxLabel(/^Bin Sites & Grain on Farm \(/)).toBe('Bin Sites & Grain on Farm (3)');
    expect(previewText()).toContain('Bin Sites & Grain on Farm · 15,000 bu on farm');
    // Crop, On Farm, Sold, Grade, Target ($/bu), Last Bid — site bands are single colspan cells.
    expect(sectionRows('Bin Sites & Grain on Farm')).toEqual([
      ['North bins · 30,000 bu capacity'],
      ['YC', '12,000 bu', '—', '—', '$4.50', '-0.35'],
      ['Bin site'],
      ['No grain on farm recorded'],
      ['Not tied to a bin site'],
      ['YSB', '3,000 bu', '1,000 bu', 'TW 58', '—', '—'],
    ]);
  });

  // ── Print / close ─────────────────────────────────────────────────────────

  it('hands the print window an escaped report with only the enabled sections', () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const printWindow = frame.contentWindow!;
    printWindow.print = vi.fn();
    let written = '';
    vi.spyOn(printWindow.document, 'write').mockImplementation((...chunks: string[]) => { written += chunks.join(''); });
    vi.spyOn(printWindow.document, 'close').mockImplementation(() => undefined);
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(printWindow);

    open({
      customer: makeCustomer({ name: 'Smith & <b>Sons</b>' }),
      contracts: [makeContract({ sourceContractId: 'PCW100' })],
      storedGrain: [makeStoredGrain()],
    });
    setChecked(/^Grain in Storage \(/, false);
    click(Array.from(host().querySelectorAll('app-button button')).find(b => squash(b.textContent) === 'Print Report'));

    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(written).toContain('<title>Producer Report - Smith &amp; &lt;b&gt;Sons&lt;/b&gt;</title>');
    expect(written).not.toContain('<b>Sons</b>');
    expect(written).toContain('Prepared by Caden Egr');
    expect(written).toContain('>Contracts</div>');
    expect(written).toContain('PCW100');
    expect(written).toContain('Total Contracted');
    expect(written).not.toContain('Grain in Storage');                // unchecked → left off the page
    expect(toast.success).toHaveBeenCalledWith('Print dialog opened');
    frame.remove();
  });

  it('warns when the pop-up is blocked, and Cancel emits close', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    open();
    let closed = 0;
    component.close.subscribe(() => closed++);

    click(Array.from(host().querySelectorAll('app-button button')).find(b => squash(b.textContent) === 'Print Report'));
    expect(toast.warning).toHaveBeenCalledWith('Unable to open print window. Check pop-up blocker settings.');
    expect(toast.success).not.toHaveBeenCalled();

    click(Array.from(host().querySelectorAll('app-button button')).find(b => squash(b.textContent) === 'Cancel'));
    expect(closed).toBe(1);
  });
});
