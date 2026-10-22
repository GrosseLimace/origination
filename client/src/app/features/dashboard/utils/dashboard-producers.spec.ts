import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Commodity, Contract, Customer, PlantingIntention } from '@models';
import {
  ProducerTabRow, applyProducerFilters, buildCustomerCropsById, buildLastContactByCustomer, buildProducersWithIntentionsRows,
  buildProducersWithoutIntentionsRows, narrowProducerRowsToChip, sortProducerRows, withIntentionsChipOptions,
  withoutIntentionsChipOptions,
} from './dashboard-producers';

const COMMODITIES = new Map<string, Commodity>([
  ['YC', { id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true }],
  ['SB', { id: 2, code: 'SB', name: 'Soybeans', category: 'Soybeans', isActive: true }],
  ['HRW', { id: 3, code: 'HRW', name: 'Hard Red Winter Wheat', category: 'Wheat', isActive: true }],
]);

function customer(over: Partial<Customer>): Customer {
  return {
    id: 0, name: '', farm: '', location: '', phone: '', email: '', totalAcres: 0,
    linkedProducerIds: [], eSignEnabled: false, achEnabled: false, ...over,
  };
}

function pi(over: Partial<PlantingIntention>): PlantingIntention {
  return {
    id: 0, customerId: 1, customerName: 'Alpha Farms', customerCode: 'ALPHA', tradeUnit: '2090',
    plantingYear: 2026, crop: 'YC', acres: 0, createdAt: '2026-01-01', createdBy: 'test', ...over,
  };
}

function contract(over: Partial<Contract>): Contract {
  return {
    id: 0, customerId: 1, ctrmCustomerId: 'ALPHA', sourceContractId: 'P0', farmId: 'F1', contractNumber: '0',
    contractPrefixType: 'P', commodityCode: 'YC', commodityDescription: 'Corn', commodityGroup: 'Corn',
    quantity: 0, unit: 'BU', price: 0, cropYear: 2026, deliveryStart: new Date(2026, 9, 15), deliveryEnd: new Date(2026, 11, 31),
    status: 'Active', signed: true, ...over,
  };
}

const ALPHA = customer({ id: 1, scoularId: 'ALPHA', name: 'Alpha Farms', totalAcres: 400 });
const BRAVO = customer({ id: 2, scoularId: 'BRAVO', name: 'Bravo Ag', totalAcres: 300 });

describe('buildProducersWithIntentionsRows', () => {
  const rows = buildProducersWithIntentionsRows(
    [
      pi({ crop: 'YC', type: 'Irrigated', acres: 100 }),
      pi({ crop: 'YC', type: 'Dryland', acres: 50 }),
      pi({ crop: 'YC', type: 'Irrigated', acres: 1000, tradeUnit: '3811' }),
      pi({ customerId: 2, customerName: 'Bravo Ag', crop: 'SB', acres: 200 }),
      pi({ customerId: 9, customerName: 'Unknown', crop: 'ZZ', acres: 5 }),
    ],
    new Map<string, number | null>([['Irrigated Corn', 200], ['Dryland Corn', null], ['Soybeans', 50]]),
    new Map([[1, ALPHA], [2, BRAVO]]),
    COMMODITIES,
  );

  it('sums acres and estimated production per producer, joining their trade units', () => {
    expect(rows.map(r => [r.customerId, r.customerName, r.scoularId, r.tradeUnit, r.acres, r.production])).toEqual([
      [1, 'Alpha Farms', 'ALPHA', '2090, 3811', 1150, 220000], // dryland has no estimate → 0 production
      [2, 'Bravo Ag', 'BRAVO', '2090', 200, 10000],
      [9, 'Unknown', null, '2090', 5, null], // no estimate → null, not 0
    ]);
    expect(rows[0].customer).toBe(ALPHA);
    expect(rows[2].customer).toBeUndefined();
    expect(rows.every(r => r.highlightedCrops === null)).toBe(true);
  });

  it('breaks each producer down per type + crop code, with category keys and acre chips', () => {
    expect(rows[0].crops).toEqual(['Dryland YC', 'Irrigated YC']);
    expect(rows[0].cropCategoryKeys).toEqual(['Dryland Corn', 'Irrigated Corn']);
    expect(rows[0].cropEntries).toEqual([
      { display: 'Dryland YC', category: 'Dryland Corn', colorKey: 'Corn', acres: 50, production: 0 },
      { display: 'Irrigated YC', category: 'Irrigated Corn', colorKey: 'Corn', acres: 1100, production: 220000 },
    ]);
    // Grouped by crop, then largest first; thousands separated.
    expect(rows[0].plantingChips).toEqual([
      { display: 'Irrigated YC', colorKey: 'Corn', text: 'Irrigated YC · 1,100 ac' },
      { display: 'Dryland YC', colorKey: 'Corn', text: 'Dryland YC · 50 ac' },
    ]);
  });
});

describe('buildCustomerCropsById', () => {
  it('merges producer-detail crops (else the customer list) with contract crops, de-duplicated case-insensitively', () => {
    const map = buildCustomerCropsById(
      [{ customerId: 1, commodities: 'YC, sb ,' } as never, { customerId: 2, commodities: ' , ' } as never],
      [
        contract({ ctrmCustomerId: 'ALPHA', commodityCode: 'SB' }),
        contract({ ctrmCustomerId: 'ALPHA', commodityCode: 'HRW' }),
        contract({ ctrmCustomerId: 'BRAVO', commodityCode: '', commodityDescription: 'Milo' }),
        contract({ ctrmCustomerId: '', commodityCode: 'ZZ' }),
        contract({ ctrmCustomerId: 'BRAVO', commodityCode: '', commodityDescription: '', commodityGroup: ' ' }),
      ],
      [
        ALPHA,
        { ...BRAVO, commodities: ['YC'] },
        customer({ id: 3, name: 'No crops' }),
      ],
    );

    expect([...map.entries()]).toEqual([
      [1, ['YC', 'sb', 'HRW']],
      [2, ['YC', 'Milo']], // empty producer-detail list falls back to the customer's own commodities
    ]);
  });
});

describe('buildProducersWithoutIntentionsRows', () => {
  const base = {
    plantingIntentions: [
      pi({ customerId: 1, crop: 'YC', acres: 10 }),
      pi({ customerId: 2, crop: 'SB', acres: 10, tradeUnit: '3811' }), // another trade unit
      pi({ customerId: 3, crop: 'SB', acres: 10, plantingYear: 2025 }), // another year
    ],
    customers: [ALPHA, BRAVO, customer({ id: 3, scoularId: 'CHARLIE', name: 'Charlie Grain', totalAcres: 100 })],
    year: 2026,
    cropFilter: '',
    tradeUnitSet: new Set(['2090']),
    commodityByCode: COMMODITIES,
    cropsMap: new Map([[1, ['YC']], [2, ['SB', 'YC']], [3, ['HRW', 'yc']]]),
  };

  it('lists producers with no intention in the selected year and trade units, with crop-coloured chips', () => {
    const rows = buildProducersWithoutIntentionsRows(base);
    expect(rows.map(r => r.customerName)).toEqual(['Bravo Ag', 'Charlie Grain']);
    expect(rows[0]).toMatchObject({ customerId: 2, scoularId: 'BRAVO', customer: BRAVO, crops: ['SB', 'YC'] });
    expect(rows[0].plantingChips).toEqual([
      { display: 'YC', colorKey: 'Corn', text: 'YC' },
      { display: 'SB', colorKey: 'Soybeans', text: 'SB' },
    ]);
    // Lower-case codes still resolve through the upper-cased lookup.
    expect(rows[1].plantingChips.map(ch => ch.colorKey)).toEqual(['Corn', 'Wheat']);
  });

  it('treats an empty trade-unit set (All Producers) as every trade unit', () => {
    expect(buildProducersWithoutIntentionsRows({ ...base, tradeUnitSet: new Set() }).map(r => r.customerId)).toEqual([3]);
  });

  it('narrows to producers who grow the top-filter crop but have no intention for it', () => {
    expect(buildProducersWithoutIntentionsRows({ ...base, cropFilter: 'Corn' }).map(r => r.customerId)).toEqual([2, 3]);
    expect(buildProducersWithoutIntentionsRows({ ...base, cropFilter: 'Wheat' }).map(r => r.customerId)).toEqual([3]);
    // A crop code typed as the filter matches the code itself.
    expect(buildProducersWithoutIntentionsRows({ ...base, cropFilter: 'HRW' }).map(r => r.customerId)).toEqual([3]);
  });
});

describe('applyProducerFilters', () => {
  const rows: ProducerTabRow[] = [
    { customerId: 1, customerName: 'Alpha Farms', scoularId: 'ALPHA', customer: undefined, crops: ['Dryland YC'], cropCategoryKeys: ['Dryland Corn'], plantingChips: [] },
    { customerId: 2, customerName: 'Bravo Ag', scoularId: null, customer: undefined, crops: ['SB'], plantingChips: [] },
  ];
  const ids = (rs: ProducerTabRow[]) => rs.map(r => r.customerId);

  it('searches name and producer ID, trimmed and case-insensitive', () => {
    expect(ids(applyProducerFilters(rows, 'with', '  alp ', '', false))).toEqual([1]);
    expect(ids(applyProducerFilters(rows, 'with', 'ag', '', false))).toEqual([2]);
    expect(ids(applyProducerFilters(rows, 'with', '', '', false))).toEqual([1, 2]);
  });

  it('matches the chip against category keys on the With view without a top filter, else against crops', () => {
    expect(ids(applyProducerFilters(rows, 'with', '', ' dryland corn ', false))).toEqual([1]);
    expect(ids(applyProducerFilters(rows, 'with', '', 'Dryland YC', false))).toEqual([]);
    expect(ids(applyProducerFilters(rows, 'with', '', 'dryland yc', true))).toEqual([1]);
    expect(ids(applyProducerFilters(rows, 'without', '', 'sb', false))).toEqual([2]);
  });
});

describe('narrowProducerRowsToChip', () => {
  const row: ProducerTabRow = {
    customerId: 1, customerName: 'Alpha', scoularId: null, customer: undefined, acres: 150, production: 26000,
    crops: ['Dryland YC', 'Irrigated YC'], plantingChips: [],
    cropEntries: [
      { display: 'Dryland YC', category: 'Dryland Corn', colorKey: 'Corn', acres: 50, production: 0 },
      { display: 'Irrigated YC', category: 'Irrigated Corn', colorKey: 'Corn', acres: 100, production: 20000.4 },
    ],
  };

  it('narrows acres and production to the matching crop and highlights it, on the With view only', () => {
    expect(narrowProducerRowsToChip([row], 'with', 'Irrigated Corn', false)[0]).toMatchObject({
      acres: 100, production: 20000, highlightedCrops: new Set(['Irrigated YC']),
    });
    // With a top filter set, the chip is a type + crop code.
    expect(narrowProducerRowsToChip([row], 'with', 'dryland yc', true)[0]).toMatchObject({ acres: 50, production: null });
  });

  it('leaves rows untouched with no chip, on the Without view, or when nothing matches', () => {
    const rows = [row];
    expect(narrowProducerRowsToChip(rows, 'with', '  ', false)).toBe(rows);
    expect(narrowProducerRowsToChip(rows, 'without', 'irrigated corn', false)).toBe(rows);
    expect(narrowProducerRowsToChip(rows, 'with', 'soybeans', false)[0]).toBe(row);
  });
});

describe('sortProducerRows', () => {
  const r = (id: number, acres: number | undefined, production: number | null | undefined, totalAcres = 0): ProducerTabRow => ({
    customerId: id, customerName: `P${id}`, scoularId: null, customer: customer({ id, totalAcres }), acres, production,
    crops: [], plantingChips: [],
  });

  it('sorts by acres (farm acres standing in when a row has none) or production, in either direction', () => {
    const rows = [r(1, 100, 5), r(2, undefined, null, 300), r(3, 200, 50)];
    expect(sortProducerRows(rows, 'acres', -1).map(x => x.customerId)).toEqual([2, 3, 1]);
    expect(sortProducerRows(rows, 'acres', 1).map(x => x.customerId)).toEqual([1, 3, 2]);
    expect(sortProducerRows(rows, 'production', -1).map(x => x.customerId)).toEqual([3, 1, 2]);
    expect(rows.map(x => x.customerId)).toEqual([1, 2, 3]); // a copy, not in place
  });
});

describe('chip options', () => {
  it('With view: category keys without a top filter, type + crop codes with one', () => {
    const rows = [
      { crops: ['Irrigated YC', 'Dryland YC'], cropCategoryKeys: ['Irrigated Corn', 'Dryland Corn'] },
      { crops: ['SB'], cropCategoryKeys: ['Soybeans', 'Dryland Corn'] },
    ];
    expect(withIntentionsChipOptions(rows, false)).toEqual(['Dryland Corn', 'Irrigated Corn', 'Soybeans']);
    expect(withIntentionsChipOptions(rows, true)).toEqual(['Dryland YC', 'Irrigated YC', 'SB']);
  });

  it('Without view: every crop code, limited to the top-filter crop when one is set', () => {
    const rows = [{ crops: ['YC', ' SB ', ''] }, { crops: ['HRW', 'yc', 'Corn'] }];
    expect(withoutIntentionsChipOptions(rows, '', COMMODITIES)).toEqual(['Corn', 'HRW', 'SB', 'YC', 'yc']);
    expect(withoutIntentionsChipOptions(rows, 'Corn', COMMODITIES)).toEqual(['Corn', 'YC', 'yc']);
  });
});

describe('buildLastContactByCustomer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T12:00:00'));
  });
  afterEach(() => vi.useRealTimers());

  const at = (d: number) => new Date(2026, 9, d, 12);

  it('describes recency in bands, by the latest note across linked producers in both directions', () => {
    const customers = [
      customer({ id: 1, scoularId: 'A' }),
      customer({ id: 2, scoularId: 'B', linkedProducerIds: ['C'] }),
      customer({ id: 3, scoularId: 'C' }),
      customer({ id: 4, scoularId: 'D' }),
      customer({ id: 5, scoularId: 'E' }),
      customer({ id: 6, scoularId: 'F' }),
      customer({ id: 7 }),
      customer({ id: 8, scoularId: 'G', linkedProducerIds: ['H'] }),
      customer({ id: 9, scoularId: 'H' }),
    ];
    const map = buildLastContactByCustomer([
      { customerId: 1, customerCode: 'A', lastNoteAt: at(13) },
      { customerId: 1, customerCode: 'A', lastNoteAt: at(1) }, // older row for the same code is ignored
      { customerId: 3, customerCode: 'C', lastNoteAt: at(12) },
      { customerId: 4, customerCode: 'D', lastNoteAt: at(9) },
      { customerId: 5, customerCode: 'E', lastNoteAt: at(1) },
      { customerId: 6, customerCode: 'F', lastNoteAt: new Date(2026, 7, 1, 12) },
      { customerId: 8, customerCode: 'G', lastNoteAt: at(11) },
      { customerId: 0, lastNoteAt: at(13) }, // no code — ignored
    ], customers);

    expect(map.get(1)).toEqual({ text: 'Contacted today', colorClass: 'text-scoular-green', daysAgo: 0 });
    // B links to C, so C's note counts for B.
    expect(map.get(2)).toEqual({ text: 'Contacted yesterday', colorClass: 'text-scoular-green', daysAgo: 1 });
    expect(map.get(3)).toEqual({ text: 'Contacted yesterday', colorClass: 'text-scoular-green', daysAgo: 1 });
    // G links to H, so H sees G's note through the reverse edge.
    expect(map.get(9)).toEqual({ text: 'Contacted 2 days ago', colorClass: 'text-scoular-green', daysAgo: 2 });
    expect(map.get(4)).toEqual({ text: 'Contacted 4 days ago', colorClass: 'text-scoular-green', daysAgo: 4 });
    expect(map.get(5)).toEqual({ text: 'Contacted 12 days ago', colorClass: 'text-yellow-500', daysAgo: 12 });
    expect(map.get(6)).toEqual({ text: 'Contacted 73 days ago', colorClass: 'text-scoular-red', daysAgo: 73 });
    expect(map.has(7)).toBe(false);
  });

  it('reads a zone-less timestamp string as UTC', () => {
    const map = buildLastContactByCustomer(
      [{ customerId: 1, customerCode: 'A', lastNoteAt: '2026-10-13T02:00:00' as unknown as Date }],
      [customer({ id: 1, scoularId: 'A' })],
    );
    const expectedDays = Math.round((new Date(2026, 9, 13).getTime() - (() => {
      const d = new Date('2026-10-13T02:00:00Z'); d.setHours(0, 0, 0, 0); return d.getTime();
    })()) / 86400000);
    expect(map.get(1)?.daysAgo).toBe(expectedDays);
  });
});
