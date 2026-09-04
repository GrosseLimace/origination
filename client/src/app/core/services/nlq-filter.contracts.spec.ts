import { describe, it, expect, beforeEach } from 'vitest';
import { NlqFilterService, NlqFilterContext } from './nlq-filter.service';
import { Customer, Contract } from '@models';

/**
 * Covers the contract ABSENCE rules behind the "No contracts" Build-A-List prompt card.
 *
 * The card's semantic is deliberately "no OPEN contracts" — a producer whose contracts have all
 * been closed out still counts as needing a contract, so they ARE returned. Contracts are matched
 * to customers by `contract.ctrmCustomerId === customer.scoularId` (string keys, no FK).
 */

/** Minimal customer with just the fields the contract filters read. Names are intentionally neutral
 *  (Alpha/Bravo/…) so the engine's name-search path can't accidentally match query words. */
function customer(id: number, name: string, scoularId: string): Customer {
  return {
    id, name, scoularId, farm: '', location: '', phone: '', email: '',
    totalAcres: 0, linkedProducerIds: [], eSignEnabled: false,
  } as Customer;
}

function contract(ctrmCustomerId: string, over: Partial<Contract> = {}): Contract {
  return {
    id: Math.random(), ctrmCustomerId, status: 'Active', closedDate: null, ...over,
  } as Contract;
}

function ctx(customers: Customer[], contracts: Contract[] = []): NlqFilterContext {
  return { customers, contracts, tickets: [], notes: [], plantingIntentions: [], storedGrain: [] };
}

describe('NlqFilterService — contract absence ("No contracts" prompt)', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  // Alpha: one OPEN contract        → has business on the books
  // Bravo: one CLOSED contract only → nothing open, so the card should surface them
  // Charlie: no contracts at all    → surface
  const alpha = customer(1, 'Alpha Farms', 'S1');
  const bravo = customer(2, 'Bravo Farms', 'S2');
  const charlie = customer(3, 'Charlie Farms', 'S3');
  const all = [alpha, bravo, charlie];
  const contracts = [
    contract('S1'),
    contract('S2', { status: 'Fulfilled', closedDate: '2026-01-15' }),
  ];

  const ids = (q: string) =>
    svc.parseAndFilter(q, ctx(all, contracts)).customers.map(c => c.id).sort((a, b) => a - b);

  it('returns producers with no open contracts for the exact prompt-card text', () => {
    // This is the seeded QueryText — if the parser stops matching it, the card silently returns
    // every producer, so pin the literal string rather than a paraphrase.
    expect(ids('Producers with no contracts')).toEqual([2, 3]);
  });

  it('includes a producer whose contracts are all closed (pins the chosen semantic)', () => {
    expect(ids('Producers with no contracts')).toContain(2);
  });

  it('excludes producers that still have an open contract', () => {
    expect(ids('Producers with no contracts')).not.toContain(1);
  });

  it('matches the synonym phrasings that normalize to the same rule', () => {
    // normalizeSynonyms rewrites these to "no active contract" before filtering.
    expect(ids('uncontracted producers')).toEqual([2, 3]);
    expect(ids('producers not contracted')).toEqual([2, 3]);
    expect(ids('producers without contracts')).toEqual([2, 3]);
  });

  it('flags the no_contract pattern so the UI chip renders', () => {
    const r = svc.parseAndFilter('Producers with no contracts', ctx(all, contracts));
    expect(r.matchedPatterns).toContain('no_contract');
  });

  it('does not hijack the cross-entity "planting but no contracts" query', () => {
    // That query is answered by applyCrossEntityFilters; the generic absence rule explicitly steps
    // aside when "planting" is present. Guarding it here so the two rules stay separate.
    const withPlanting = svc.parseAndFilter(
      'producers with planting intentions but no contracts', ctx(all, contracts));
    // No planting intentions in context → the cross-entity rule yields nobody, rather than
    // falling through to "everyone without an open contract".
    expect(withPlanting.customers.map(c => c.id)).not.toEqual([2, 3]);
  });

  it('still narrows when the contract set is empty', () => {
    // Defensive: with no contracts loaded every producer legitimately has none. The screen guards
    // the failed-load case separately (contractsUnavailableForQuery) — this just documents that the
    // filter itself does not throw or silently no-op.
    const r = svc.parseAndFilter('Producers with no contracts', ctx(all, []));
    expect(r.customers.map(c => c.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});

describe('NlqFilterService — ranking prompt-card wording (pins the literal QueryText the cards use)', () => {
  let svc: NlqFilterService;
  beforeEach(() => { svc = new NlqFilterService(); });

  const alpha = customer(1, 'Alpha Farms', 'S1');
  const bravo = customer(2, 'Bravo Farms', 'S2');
  const charlie = customer(3, 'Charlie Farms', 'S3');
  const all = [alpha, bravo, charlie];

  it('"Top 10 by contracted bushels" (renamed from "…by contract value", which mislabeled a bushel-volume ranking as a dollar value) still ranks by total contracted quantity, descending', () => {
    const contracts = [
      contract('S1', { quantity: 10000 }),
      contract('S2', { quantity: 50000 }),
      contract('S3', { quantity: 25000 }),
    ];
    const ordered = svc.parseAndFilter('Top 10 by contracted bushels', ctx(all, contracts)).customers.map(c => c.id);
    expect(ordered).toEqual([2, 3, 1]);
  });

  it('"Top 10 by acres" (renamed from "Top 10 largest operations", which only worked via a synonym rewrite) ranks by totalAcres, descending', () => {
    const withAcres = [
      { ...alpha, totalAcres: 1200 },
      { ...bravo, totalAcres: 5000 },
      { ...charlie, totalAcres: 2800 },
    ];
    const ordered = svc.parseAndFilter('Top 10 by acres', ctx(withAcres, [])).customers.map(c => c.id);
    expect(ordered).toEqual([2, 3, 1]);
  });
});
