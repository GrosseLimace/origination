import { describe, it, expect } from 'vitest';
import { RefinementFilters, Ticket } from '@models';
import { matchTicketViewModeFilters } from './ticket-view-filters';

/**
 * matchTicketViewModeFilters is shared by build-list live refinement and nlq-filter saved-list
 * re-evaluation, so the two paths must agree. This pins:
 *  - no Net bu / quality filter → null ("skip this stage"), not an empty set,
 *  - 'single' mode: every ticket (applied or not) is judged on its own,
 *  - 'grouped' mode: UNAPPLIED tickets only, grouped by productCode|elevatorCode, judged on group AVERAGES,
 *  - Net bu needs a lbs/bu conversion for the product; quality bounds do not,
 *  - over/under bounds are strict and a missing reading fails an active bound.
 */

const CORN_LBS_PER_BU = 56;

/** Fully typed Ticket fixture — an unapplied 1,000 bu corn ticket for customer FARM1 at elevator E1. */
function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    farmId: '',
    customerCode: 'FARM1',
    productCode: 'YC',
    elevatorCode: 'E1',
    ticketNumber: '1',
    date: '2026-09-15',
    grossWeight: 0,
    tareWeight: 0,
    netWeight: 0,
    appliedDockQuantity: 1_000 * CORN_LBS_PER_BU,
    isApplied: false,
    isActive: true,
    ...over,
  };
}

const codeToId = new Map<string, number>([['FARM1', 1], ['FARM2', 2]]);
const conversions = new Map<string, number>([['YC', CORN_LBS_PER_BU], ['SB', 60]]);

function run(tickets: Ticket[], mode: 'grouped' | 'single', r: RefinementFilters): number[] | null {
  const result = matchTicketViewModeFilters(tickets, codeToId, conversions, mode, r);
  return result == null ? null : [...result].sort();
}

describe('matchTicketViewModeFilters', () => {
  it('returns null when no Net bu or quality filter is active, so the caller skips the stage', () => {
    expect(run([ticket()], 'grouped', {})).toBeNull();
    expect(run([ticket()], 'single', { ticketQuantityOver: 0 })).toBeNull();
    expect(run([ticket()], 'single', { ticketQuantityOver: null, avgMoistureOver: null })).toBeNull();
  });

  describe("'single' mode", () => {
    it('matches a customer when any one ticket clears the Net bu threshold, applied or not', () => {
      const tickets = [
        ticket({ customerCode: 'FARM1', isApplied: true, appliedDockQuantity: 600 * CORN_LBS_PER_BU }),
        ticket({ customerCode: 'FARM2', appliedDockQuantity: 400 * CORN_LBS_PER_BU }),
      ];
      expect(run(tickets, 'single', { ticketQuantityOver: 500 })).toEqual([1]);
    });

    it('judges tickets individually, never summing them', () => {
      const tickets = [
        ticket({ appliedDockQuantity: 300 * CORN_LBS_PER_BU }),
        ticket({ appliedDockQuantity: 300 * CORN_LBS_PER_BU }),
      ];
      expect(run(tickets, 'single', { ticketQuantityOver: 500 })).toEqual([]);
    });

    it('requires a single ticket to satisfy EVERY active filter at once', () => {
      const tickets = [
        ticket({ appliedDockQuantity: 900 * CORN_LBS_PER_BU, moisture: 18 }), // bu ok, too wet
        ticket({ appliedDockQuantity: 100 * CORN_LBS_PER_BU, moisture: 14 }), // dry, too small
      ];
      const r: RefinementFilters = { ticketQuantityOver: 500, avgMoistureUnder: 15 };
      expect(run(tickets, 'single', r)).toEqual([]);
      expect(run([...tickets, ticket({ appliedDockQuantity: 900 * CORN_LBS_PER_BU, moisture: 14 })], 'single', r)).toEqual([1]);
    });

    it('skips tickets whose product has no lbs/bu conversion for Net bu, but not for quality', () => {
      const unknownProduct = ticket({ productCode: 'ZZ', appliedDockQuantity: 1_000_000, proteinPercent: 13 });
      expect(run([unknownProduct], 'single', { ticketQuantityOver: 1 })).toEqual([]);
      expect(run([unknownProduct], 'single', { avgProteinOver: 12 })).toEqual([1]);
    });

    it('normalises product code case and whitespace when looking up the conversion', () => {
      expect(run([ticket({ productCode: ' yc ' })], 'single', { ticketQuantityOver: 999 })).toEqual([1]);
    });

    it('ignores tickets with no customer code or an unknown customer', () => {
      const tickets = [ticket({ customerCode: undefined }), ticket({ customerCode: 'NOBODY' })];
      expect(run(tickets, 'single', { ticketQuantityOver: 1 })).toEqual([]);
    });
  });

  describe("'grouped' mode", () => {
    it('only counts UNAPPLIED tickets', () => {
      const tickets = [ticket({ isApplied: true, appliedDockQuantity: 5_000 * CORN_LBS_PER_BU })];
      expect(run(tickets, 'grouped', { ticketQuantityOver: 500 })).toEqual([]);
    });

    it('compares Net bu against the AVERAGE bushels per ticket within a product|elevator group', () => {
      // 4 tickets totalling 4,400 bu → avg 1,100 bu/ticket.
      const tickets = [1_000, 1_000, 1_200, 1_200].map(bu => ticket({ appliedDockQuantity: bu * CORN_LBS_PER_BU }));
      expect(run(tickets, 'grouped', { ticketQuantityOver: 1_000 })).toEqual([1]);
      expect(run(tickets, 'grouped', { ticketQuantityOver: 1_100 })).toEqual([]); // strict >
    });

    it('keeps elevator groups separate (trimmed, case-insensitive) — one passing group is enough', () => {
      const tickets = [
        ticket({ elevatorCode: 'E1', moisture: 20 }),
        ticket({ elevatorCode: 'e2', moisture: 13 }),
        ticket({ elevatorCode: 'E2 ', moisture: 14 }), // same group as 'e2' after trim/upper
      ];
      // E1 avg 20 fails; E2 avg 13.5 passes.
      expect(run(tickets, 'grouped', { avgMoistureUnder: 15 })).toEqual([1]);
      // Pooling everything would give avg 15.67 and pass this window — the per-group rule must not.
      expect(run(tickets, 'grouped', { avgMoistureOver: 15, avgMoistureUnder: 16 })).toEqual([]);
    });

    it('averages each quality reading only over tickets that have it', () => {
      const tickets = [ticket({ testWeight: 58 }), ticket({ testWeight: undefined }), ticket({ testWeight: 56 })];
      expect(run(tickets, 'grouped', { avgTestWeightOver: 56.9, avgTestWeightUnder: 57.1 })).toEqual([1]);
    });

    it('fails an active quality bound when the group has no reading for it', () => {
      expect(run([ticket({ proteinPercent: undefined })], 'grouped', { avgProteinOver: 10 })).toEqual([]);
    });

    it('treats over/under as strict bounds', () => {
      const tickets = [ticket({ moisture: 15 })];
      expect(run(tickets, 'grouped', { avgMoistureOver: 15 })).toEqual([]);
      expect(run(tickets, 'grouped', { avgMoistureUnder: 15 })).toEqual([]);
      expect(run(tickets, 'grouped', { avgMoistureOver: 14.9, avgMoistureUnder: 15.1 })).toEqual([1]);
    });

    it('evaluates customers independently', () => {
      const tickets = [
        ticket({ customerCode: 'FARM1', appliedDockQuantity: 2_000 * CORN_LBS_PER_BU }),
        ticket({ customerCode: 'FARM2', productCode: 'SB', appliedDockQuantity: 2_000 * 60 }),
        ticket({ customerCode: 'FARM2', productCode: 'SB', elevatorCode: 'E9', appliedDockQuantity: 10 * 60 }),
      ];
      expect(run(tickets, 'grouped', { ticketQuantityOver: 1_500 })).toEqual([1, 2]);
    });
  });
});
