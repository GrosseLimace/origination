import { describe, it, expect, vi } from 'vitest';
import { RefinementFilters } from '@models';
import { detectFocusTab } from './focus-tab';

const dp = (q: string) => /\bdp\b/.test(q);
const tab = (q: string, r: RefinementFilters = {}, notes = false) => detectFocusTab(r, q, notes, dp);

describe('detectFocusTab', () => {
  it('opens no particular tab for note prompts or prompts with no clear focus', () => {
    expect(tab('Producers contacted about contracts', {}, true)).toBeNull();
    expect(tab('All producers')).toBeNull();
    expect(tab('All producers', { acresOver: 100, states: ['KS'] })).toBeNull();
  });

  it('checks DP before storage, so a DP prompt with storage vocabulary lands on DP', () => {
    expect(tab('Producers on DP with storage over 90 days')).toBe('dpContracts');
    for (const r of [{ hasDpContracts: true }, { dpBushelsOver: 1 }, { dpDaysOver: 1 }, { dpChargesOver: 1 }] as RefinementFilters[]) {
      expect(tab('Producers with grain in storage', r)).toBe('dpContracts');
    }
    expect(tab('All producers', { dpDaysOver: 0 })).toBeNull();
  });

  it('passes the lower-cased prompt to the DP detector', () => {
    const detector = vi.fn(() => false);
    detectFocusTab({}, 'Producers ON DP', false, detector);
    expect(detector).toHaveBeenCalledWith('producers on dp');
  });

  it('storage', () => {
    expect(tab('Stored grain report')).toBe('storage');
    for (const r of [{ storageDaysOver: 1 }, { storageQuantityOver: 1 }, { storageReceivableOver: 1 }, { hasGrainInStorage: true }] as RefinementFilters[]) {
      expect(tab('All producers', r)).toBe('storage');
    }
  });

  it('applied tickets open Contracts; other ticket prompts and refinements open Tickets', () => {
    expect(tab('Producers with applied tickets')).toBe('contracts');
    expect(tab('Producers with unapplied tickets')).toBe('tickets');
    expect(tab('Ticket report')).toBe('tickets');
    for (const r of [{ ticketQuantityOver: 1 }, { ticketsInLastDays: 1 }, { avgProteinUnder: 0 }, { avgTestWeightOver: 0 }] as RefinementFilters[]) {
      expect(tab('All producers', r)).toBe('tickets');
    }
  });

  it('planting', () => {
    expect(tab('Planting intentions for 2026')).toBe('planting');
    expect(tab('Seeding intention')).toBe('planting');
    for (const r of [{ plantingYear: 2026 }, { drylandOnly: true }, { doubleCropOnly: true }, { plantingAcresOver: 1 }, { hasPlantingIntentions: true }] as RefinementFilters[]) {
      expect(tab('All producers', r)).toBe('planting');
    }
  });

  it('contracts, from contract vocabulary or any contract refinement', () => {
    for (const q of ['contract holders', 'unsigned', 'expiring soon', 'unpriced', 'overdue bushels']) expect(tab(q)).toBe('contracts');
    for (const r of [{ noActiveContracts: true }, { downHarvestPace: true }, { contractQuantityOver: 1 }, { multipleCommoditiesContracted: true }] as RefinementFilters[]) {
      expect(tab('All producers', r)).toBe('contracts');
    }
  });
});
