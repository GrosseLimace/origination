import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Commodity, Contract, Customer, DpContract, Note, PlantingIntention, RefinementFilters, StoredGrain, Ticket } from '@models';
import { buildCropGroupLookup } from '@shared/utils/crop-group-match';
import { buildLinkedProducerComponents } from '@shared/utils/linked-producers';
import { applyMemberOverrides, collapseLinkedComponents, filterByRefinements, RefinementFilterSources } from './refinement-filters';

const NOW = new Date('2026-10-13T12:00:00');
const DAY = 86400000;

function customer(id: number, over: Partial<Customer> = {}): Customer {
  return {
    id, name: `P${id}`, scoularId: `C${id}`, farm: '', location: '', phone: '', email: '', totalAcres: 0,
    linkedProducerIds: [], eSignEnabled: false, achEnabled: false, ...over,
  };
}

function contract(over: Partial<Contract>): Contract {
  return {
    id: 1, customerId: 1, ctrmCustomerId: 'C1', sourceContractId: 'P1', farmId: 'F', contractNumber: '1',
    contractPrefixType: 'P', commodityCode: 'YC', commodityDescription: 'Corn', commodityGroup: 'Corn',
    quantity: 1000, unit: 'bushels', price: 0, openBalanceQuantity: 0,
    deliveryStart: new Date(NOW.getTime() - 60 * DAY), deliveryEnd: new Date(NOW.getTime() + 60 * DAY),
    status: 'Active', signed: true, priceTypeCode: 'P', ...over,
  };
}

const note = (over: Partial<Note>): Note => ({
  id: 1, customerId: 1, customerName: '', customerCode: 'C1', content: '', isPinned: false,
  createdBy: 'someone', createdAt: NOW, ...over,
});

const ALL = [customer(1), customer(2), customer(3)];
const ids = (list: Customer[]) => list.map(c => c.id);

/** Sources over plain arrays; every accessor is a spy so a test can see what was (not) read. */
function sources(data: {
  customers?: Customer[]; notes?: Note[]; tickets?: Ticket[]; planting?: PlantingIntention[];
  storage?: StoredGrain[]; dp?: DpContract[]; contracts?: Contract[];
  lastContact?: Map<number, { daysAgo: number }>; account?: { name?: string; username?: string };
  pacing?: (c: Customer) => 'up' | 'down' | 'flat' | null; appliedTickets?: boolean; dimension?: string | null;
  commodities?: Commodity[];
} = {}) {
  const customers = data.customers ?? ALL;
  const open = new Map<string, Contract[]>();
  for (const c of data.contracts ?? []) {
    if (!c.ctrmCustomerId || c.closedDate) continue;
    open.set(c.ctrmCustomerId, [...(open.get(c.ctrmCustomerId) ?? []), c]);
  }
  const src = {
    customers: vi.fn(() => customers),
    notes: vi.fn(() => data.notes ?? []),
    tickets: vi.fn(() => data.tickets ?? []),
    plantingIntentions: vi.fn(() => data.planting ?? []),
    storedGrain: vi.fn(() => data.storage ?? []),
    dpContracts: vi.fn(() => data.dp ?? []),
    openContractsByCustomer: vi.fn(() => open),
    cropGroupLookup: vi.fn(() => buildCropGroupLookup(data.commodities ?? [])),
    lastContactByCustomer: vi.fn(() => data.lastContact ?? new Map()),
    linkedProducerComponents: vi.fn(() => buildLinkedProducerComponents(customers)),
    commodityConversions: vi.fn(() => [{ commodityCode: 'YC', lbsPerUnit: 56 }, { commodityCode: 'SBM', lbsPerUnit: 2000 }]),
    currentAccount: vi.fn(() => data.account ?? { name: 'Pat Merchant', username: 'pat@scoular.com' }),
    pacingDirection: vi.fn(data.pacing ?? (() => null)),
    isAppliedTicketsContext: vi.fn(() => data.appliedTickets ?? false),
    refineDimension: vi.fn(() => data.dimension ?? null),
  } satisfies RefinementFilterSources;
  return src;
}

const run = (r: RefinementFilters, src = sources(), list: Customer[] = ALL) => ids(filterByRefinements(list, r, src));

describe('filterByRefinements', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => vi.useRealTimers());

  it('returns the list untouched with no refinements, reading only the always-needed sources', () => {
    const src = sources();
    expect(run({}, src)).toEqual([1, 2, 3]);
    expect(src.customers).not.toHaveBeenCalled();
    expect(src.notes).not.toHaveBeenCalled();
    expect(src.tickets).not.toHaveBeenCalled();
    expect(src.storedGrain).toHaveBeenCalled(); // the crop-scoped storage set is built eagerly
    expect(src.dpContracts).not.toHaveBeenCalled();
    expect(src.currentAccount).not.toHaveBeenCalled();
  });

  describe('contracts', () => {
    const contracts = [
      contract({ id: 1, ctrmCustomerId: 'C1', priceTypeCode: 'U', quantity: 5600, unit: 'bushels' }),
      contract({ id: 2, ctrmCustomerId: 'C2', status: 'Fulfilled', commodityCode: 'SB', commodityDescription: 'Soybeans', commodityGroup: 'Soybeans' }),
      contract({ id: 3, ctrmCustomerId: 'C3', status: 'Pending', closedDate: new Date(NOW.getTime() - DAY) }),
    ];

    it('none active / no contracts at all / has active read open contracts only', () => {
      const src = sources({ contracts });
      expect(run({ noActiveContracts: true }, src)).toEqual([2, 3]);
      expect(run({ noContractsAtAll: true }, src)).toEqual([3]);
      expect(run({ hasActiveContracts: true }, src)).toEqual([1]);
    });

    it('unpriced keeps U/D price types; a crop chip scopes which contracts count', () => {
      const src = sources({ contracts: [...contracts, contract({ id: 4, ctrmCustomerId: 'C2', priceTypeCode: 'D', commodityCode: 'SB', commodityDescription: 'Soybeans', commodityGroup: 'Soybeans' })] });
      expect(run({ hasUnpricedContracts: true }, src)).toEqual([1, 2]);
      expect(run({ hasUnpricedContracts: true, crops: ['SB'] }, { ...src, refineDimension: vi.fn(() => 'Contracts') })).toEqual([2]);
    });

    it('contract quantity is compared in bushels', () => {
      const src = sources({ contracts: [contract({ ctrmCustomerId: 'C1', quantity: 5600 }), contract({ ctrmCustomerId: 'C2', quantity: 4000 })] });
      expect(run({ contractQuantityOver: 5000 }, src)).toEqual([1]);
    });

    it('expiring this month, multiple commodities and overdue', () => {
      const src = sources({ contracts: [
        contract({ ctrmCustomerId: 'C1', deliveryEnd: new Date('2026-10-28T12:00:00') }),
        contract({ ctrmCustomerId: 'C2', commodityCode: 'YC' }),
        contract({ ctrmCustomerId: 'C2', commodityCode: 'SB' }),
        contract({ ctrmCustomerId: 'C3', deliveryEnd: new Date(NOW.getTime() - 3 * DAY), openBalanceQuantity: 500 }),
      ] });
      expect(run({ contractsExpiringThisMonth: true }, src)).toEqual([1, 3]);
      expect(run({ multipleCommoditiesContracted: true }, src)).toEqual([2]);
      expect(run({ hasOverdueContracts: true }, src)).toEqual([3]);
    });

    it('down harvest pace asks the pacing source per producer', () => {
      const src = sources({ pacing: c => (c.id === 2 ? 'down' : 'up') });
      expect(run({ downHarvestPace: true }, src)).toEqual([2]);
    });
  });

  describe('contacts and notes', () => {
    const lastContact = new Map([[1, { daysAgo: 3 }], [3, { daysAgo: 45 }]]);

    it('never / not contacted in N days / notes in the last N days use the last-contact map', () => {
      const src = sources({ lastContact });
      expect(run({ neverContacted: true }, src)).toEqual([2]);
      expect(run({ notContactedDays: 30 }, src)).toEqual([2, 3]);
      expect(run({ notesInLastDays: 7 }, src)).toEqual([1]);
    });

    it('note counts aggregate across a linked producer network', () => {
      const customers = [customer(1, { linkedProducerIds: ['C2'] }), customer(2), customer(3)];
      const notes = [note({ id: 1, customerCode: 'C1' }), note({ id: 2, customerCode: 'C2' }), note({ id: 3, customerCode: 'C3' })];
      const src = sources({ customers, notes });
      expect(run({ contactedOnlyOnce: true }, src, customers)).toEqual([3]);
      const many = Array.from({ length: 6 }, (_, i) => note({ id: 10 + i, customerCode: 'C3' }));
      expect(run({ contactedMoreThan5: true }, sources({ customers, notes: many }), customers)).toEqual([3]);
    });

    it('authorship is token-bounded, and empty identity claims mark no note as mine', () => {
      const notes = [
        note({ id: 1, customerCode: 'C1', createdBy: 'Pat Merchant (pat@scoular.com)' }),
        note({ id: 2, customerCode: 'C2', createdBy: 'Pat Merchantson' }),
        note({ id: 3, customerCode: 'C3', createdBy: 'pat@scoular.com' }),
        note({ id: 4, customerCode: 'C3', createdBy: 'Someone' }),
      ];
      expect(run({ contactedByMeOnly: true }, sources({ notes }))).toEqual([1]);
      expect(run({ contactedBySomeoneElse: true }, sources({ notes }))).toEqual([2, 3]);
      expect(run({ contactedByMeOnly: true }, sources({ notes, account: { name: '', username: '' } }))).toEqual([]);
    });

    it('pinned and keyword match on the customer\'s whole code network', () => {
      const customers = [customer(1, { linkedProducerIds: ['C2'] }), customer(2), customer(3)];
      const notes = [note({ id: 1, customerCode: 'C2', isPinned: true, content: 'Hail DAMAGE' }), note({ id: 2, customerCode: 'C3', content: 'fine' })];
      const src = sources({ customers, notes });
      expect(run({ hasPinnedNotes: true }, src, customers)).toEqual([1, 2]);
      expect(run({ noteKeyword: ' damage ' }, src, customers)).toEqual([1, 2]);
    });
  });

  describe('producer details and grain on farm', () => {
    const customers = [
      customer(1, { totalAcres: 900, supplementalEmail: 'x@y.z', extendedStateProvince: 'CO', stateProvince: 'KS',
        grainOnFarm: [{ commodityCode: 'YC', bushelsOnHand: 6000, targetBushels: 4.2, grade: '15.5%' }] }),
      customer(2, { extendedPrimaryPhone: '555', primaryContact: '  ', eSignEnabled: true, linkedProducerIds: ['C3'], stateProvince: 'KS',
        grainOnFarm: [{ commodityCode: 'Corn', bushelsOnHand: 3000 }, { commodityCode: 'SB', bushelsOnHand: 3000, targetBushels: 11 }] }),
      customer(3, { contacts: [{ name: 'Ins', email: 'i@n.s' }] as never, primaryContact: 'Ann', stateProvince: 'NE' }),
    ];
    // A real lookup, so YC is a CODE chip: exact on code rows, and on legacy group rows ('Corn') only via groupOnlyValue.
    const commodities = [
      { id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true },
      { id: 2, code: 'SB', name: 'Soybeans', category: 'Soybeans', isActive: true },
    ];
    const r = (f: RefinementFilters) => run(f, sources({ customers, commodities, dimension: 'Grain on Farm' }), customers);

    it('acres, contact details, linked, eSign and states (extended first)', () => {
      expect(r({ acresOver: 100 })).toEqual([1]);
      expect(r({ hasEmail: true })).toEqual([1, 3]);
      expect(r({ hasPhone: true })).toEqual([2]);
      expect(r({ hasPrimaryContact: true })).toEqual([3]);
      expect(r({ noPrimaryContact: true })).toEqual([1, 2]);
      expect(r({ hasLinkedProducers: true })).toEqual([2]);
      expect(r({ notEsignEnrolled: true })).toEqual([1, 3]);
      expect(r({ states: ['KS'] })).toEqual([2]);
      expect(r({ states: ['CO', 'NE'] })).toEqual([1, 3]);
    });

    it('grain on farm bushels, target and grade, crop-scoped (legacy group rows match a code chip)', () => {
      expect(r({ grainOnFarmBushelsOver: 5000 })).toEqual([1, 2]);
      expect(r({ grainOnFarmBushelsOver: 5000, crops: ['YC'] })).toEqual([1]);
      expect(r({ grainOnFarmBushelsOver: 2000, crops: ['YC'] })).toEqual([1, 2]);
      expect(r({ hasGrainTarget: true })).toEqual([1, 2]);
      expect(r({ noGrainTarget: true, crops: ['YC'] })).toEqual([2]);
      expect(r({ grainTargetOver: 10 })).toEqual([2]);
      expect(r({ grainTargetUnder: 5 })).toEqual([1]);
      expect(r({ hasGrade: true })).toEqual([1]);
      expect(r({ gradeOver: 15 })).toEqual([1]);
      expect(r({ gradeUnder: 15 })).toEqual([]);
    });
  });

  describe('activity, storage, DP, tickets and planting', () => {
    it('deliveries this year read the ticket date in UTC', () => {
      const tickets = [
        { id: 1, customerCode: 'C1', date: '2026-01-01' },
        { id: 2, customerCode: 'C2', date: '2025-12-31' },
      ] as Ticket[];
      expect(run({ hasDeliveriesThisYear: true }, sources({ tickets }))).toEqual([1]);
    });

    it('storage: has storage, days (CTRM days or start date), quantity and receivable, crop-scoped', () => {
      const storage = [
        { customerId: 1, crop: 'YC', quantity: 4000, storageDays: 100, receivableAmount: 50 },
        { customerId: 1, crop: 'SB', quantity: 2000, storageDays: 0, storageStartDate: new Date(NOW.getTime() - 10 * DAY), receivableAmount: 60 },
        { customerId: 2, crop: 'SB', quantity: 100, storageDays: 0, storageStartDate: new Date(NOW.getTime() - 200 * DAY), receivableAmount: 0 },
      ] as StoredGrain[];
      const src = sources({ storage, dimension: 'Storage' });
      expect(run({ hasGrainInStorage: true }, src)).toEqual([1, 2]);
      expect(run({ storageDaysOver: 90 }, src)).toEqual([1, 2]);
      expect(run({ storageDaysOver: 90, crops: ['SB'] }, src)).toEqual([2]);
      expect(run({ storageQuantityOver: 5000 }, src)).toEqual([1]);
      expect(run({ storageQuantityOver: 3000, crops: ['YC'] }, src)).toEqual([1]);
      expect(run({ storageQuantityOver: 5000, crops: ['YC'] }, src)).toEqual([]);
      expect(run({ storageReceivableOver: 100 }, src)).toEqual([1]);
    });

    it('DP: bushels counted once per delivery, charges summed across rows', () => {
      const dp = [
        { id: 'a1', ticketKey: 'a', customerId: 1, crop: 'YC', bushels: 3000, storageDays: 30, receivableAmount: 40 },
        { id: 'a2', ticketKey: 'a', customerId: 1, crop: 'YC', bushels: 3000, storageDays: 30, receivableAmount: 40 },
        { id: 'b1', ticketKey: 'b', customerId: 2, crop: 'SB', bushels: 5000, storageDays: 120, receivableAmount: 10 },
      ] as DpContract[];
      const src = sources({ dp, dimension: 'DP Contracts' });
      expect(run({ hasDpContracts: true }, src)).toEqual([1, 2]);
      expect(run({ dpBushelsOver: 4000 }, src)).toEqual([2]);
      expect(run({ dpDaysOver: 90 }, src)).toEqual([2]);
      expect(run({ dpChargesOver: 50 }, src)).toEqual([1]);
      expect(run({ dpChargesOver: 5, crops: ['SB'] }, src)).toEqual([2]);
    });

    it('tickets: recent tickets, net bushels in single mode, crop-scoped', () => {
      const tickets = [
        { id: 1, customerCode: 'C1', date: '2026-10-01', productCode: 'YC', appliedDockQuantity: 56 * 2000, moisture: 16 },
        { id: 2, customerCode: 'C2', date: '2026-06-01', productCode: 'YC', appliedDockQuantity: 56 * 500, moisture: 13 },
      ] as Ticket[];
      const src = sources({ tickets });
      expect(run({ ticketsInLastDays: 30 }, src)).toEqual([1]);
      expect(run({ ticketQuantityOver: 1000 }, src)).toEqual([1]);
      expect(run({ avgMoistureOver: 14 }, src)).toEqual([1]);
      expect(run({ ticketsInLastDays: 365, crops: ['SB'] }, { ...src, refineDimension: vi.fn(() => 'Tickets') })).toEqual([]);
      expect(run({ ticketsInLastDays: 365, crops: ['YC'] }, { ...src, refineDimension: vi.fn(() => 'Tickets') })).toEqual([1, 2]);
    });

    it('planting: year, type and acres', () => {
      const planting = [
        { customerId: 1, crop: 'YC', acres: 300, plantingYear: 2026, type: 'Irrigated' },
        { customerId: 1, crop: 'SB', acres: 300, plantingYear: 2026, type: 'Double Crop' },
        { customerId: 2, crop: 'SB', acres: 500, plantingYear: 2027, type: 'Dryland' },
      ] as PlantingIntention[];
      const src = sources({ planting });
      expect(run({ hasPlantingIntentions: true }, src)).toEqual([1, 2]);
      expect(run({ plantingYear: 2027 }, src)).toEqual([2]);
      expect(run({ irrigatedOnly: true }, src)).toEqual([1]);
      expect(run({ drylandOnly: true }, src)).toEqual([2]);
      expect(run({ doubleCropOnly: true }, src)).toEqual([1]);
      expect(run({ plantingAcresOver: 550 }, src)).toEqual([1]);
    });
  });

  describe('crop chips scope to the prompt\'s dimension', () => {
    const customers = [
      customer(1, { commodities: ['Corn'], grainOnFarm: [{ commodityCode: 'YC', bushelsOnHand: 1 }] }),
      customer(2, { commodities: ['Soybeans'] }),
      customer(3),
    ];
    const data = {
      customers,
      dp: [{ id: 'd', ticketKey: 'd', customerId: 2, crop: 'YC' }] as DpContract[],
      storage: [{ customerId: 3, crop: 'YC', quantity: 1 }] as StoredGrain[],
      tickets: [{ id: 1, customerCode: 'C2', productCode: 'YC', date: '2026-10-01' }] as Ticket[],
      planting: [{ customerId: 3, crop: 'YC', acres: 1, plantingYear: 2026 }] as PlantingIntention[],
      contracts: [contract({ ctrmCustomerId: 'C3', commodityCode: 'YC' })],
    };
    const dim = (dimension: string | null) => run({ crops: ['YC'] }, sources({ ...data, dimension }), customers);

    it('matches in the dimension\'s own data, falling back to the producer\'s commodities', () => {
      expect(dim('DP Contracts')).toEqual([2]);
      expect(dim('Storage')).toEqual([3]);
      expect(dim('Tickets')).toEqual([2]);
      expect(dim('Planting')).toEqual([3]);
      expect(dim('Contracts')).toEqual([3]);
      expect(dim('Grain on Farm')).toEqual([1]);
      expect(dim(null)).toEqual([1]);
    });
  });

  it('delivery locations match any ticket\'s elevator city regardless of crops', () => {
    const tickets = [
      { id: 1, customerCode: 'C1', elevatorCity: 'Madrid, NE' },
      { id: 2, customerCode: 'C3', elevatorCity: 'Pratt, KS' },
    ] as Ticket[];
    expect(run({ deliveryLocations: ['Pratt, KS', 'Hays, KS'] }, sources({ tickets }))).toEqual([3]);
    expect(run({ deliveryLocations: ['Madrid, NE'] }, sources({ tickets }), [customer(1, { scoularId: undefined }), customer(2)])).toEqual([]);
  });
});

describe('applyMemberOverrides', () => {
  it('drops excluded producers and appends hand-added ones that are not already listed or excluded', () => {
    const list = [customer(1), customer(2)];
    const out = applyMemberOverrides(list, new Set([2, 4]), [customer(1), customer(3), customer(4)]);
    expect(ids(out)).toEqual([1, 3]);
  });

  it('returns the same list when there are no overrides', () => {
    const list = [customer(1)];
    expect(applyMemberOverrides(list, new Set(), [])).toBe(list);
  });
});

describe('collapseLinkedComponents', () => {
  it('keeps one row per linked component (the lowest id present) and leaves standalone producers alone', () => {
    const customers = [customer(5, { linkedProducerIds: ['C2'] }), customer(2, { linkedProducerIds: ['C9'] }), customer(9), customer(4), customer(7, { scoularId: undefined })];
    const components = buildLinkedProducerComponents(customers);
    expect(ids(collapseLinkedComponents(customers, components))).toEqual([2, 4, 7]);
    // The representative is the lowest id IN THE LIST, not in the component.
    expect(ids(collapseLinkedComponents([customers[0], customers[2]], components))).toEqual([5]);
  });

  it('returns the same list when nothing is linked', () => {
    const list = [customer(1), customer(2)];
    expect(collapseLinkedComponents(list, buildLinkedProducerComponents(list))).toBe(list);
  });
});
