import { describe, it, expect } from 'vitest';
import { RefinementFilters } from '@models';
import { countActiveRefinements, hasAnyRefinement, hiddenRefineFilters } from './refine-panel';

describe('countActiveRefinements', () => {
  it('is zero for no criteria, and for empty / zero / blank ones', () => {
    expect(countActiveRefinements({})).toBe(0);
    expect(countActiveRefinements({
      crops: [], states: [], deliveryLocations: [], notContactedDays: 0, noteKeyword: '   ',
      contractQuantityOver: 0, acresOver: null, storageDaysOver: 0, dpChargesOver: 0, plantingAcresOver: 0,
    })).toBe(0);
  });

  it('counts each active criterion once', () => {
    const r: RefinementFilters = {
      hasUnpricedContracts: true,
      states: ['KS', 'NE'],
      crops: ['YC'],
      notContactedDays: 30,
      noteKeyword: 'drought',
      contractQuantityOver: 5000,
    };
    expect(countActiveRefinements(r)).toBe(6);
  });

  it('counts the quality over/under bounds even at zero (null means "not set")', () => {
    expect(countActiveRefinements({ avgMoistureOver: 0, avgProteinUnder: 0 })).toBe(2);
    expect(countActiveRefinements({ gradeOver: 0 })).toBe(1);
  });

  it('adds the grain/bin-site refinements counted by the shared helper', () => {
    expect(countActiveRefinements({ hasBinSites: true })).toBe(1);
    expect(countActiveRefinements({ hasBinSites: true, states: ['KS'] })).toBe(2);
  });
});

describe('hasAnyRefinement', () => {
  it('ignores empty/zero criteria and sees real ones', () => {
    expect(hasAnyRefinement({})).toBe(false);
    expect(hasAnyRefinement({ crops: [], states: [], notContactedDays: 0, noteKeyword: '  ' })).toBe(false);
    expect(hasAnyRefinement({ states: ['KS'] })).toBe(true);
    expect(hasAnyRefinement({ notContactedDays: 30 })).toBe(true);
    expect(hasAnyRefinement({ noBinSites: true })).toBe(true);
    expect(hasAnyRefinement({ deliveryLocations: ['Madrid, NE'] })).toBe(true);
    expect(hasAnyRefinement({ avgTestWeightUnder: 0 })).toBe(true);
  });

  // A saved list filtered only on DP used to show no "Refined" marker: these four were counted by
  // countActiveRefinements but not seen here.
  it.each([
    [{ hasDpContracts: true }], [{ dpDaysOver: 90 }], [{ dpBushelsOver: 1 }], [{ dpChargesOver: 1 }],
  ] as [RefinementFilters][])('sees the DP refinement %o, like countActiveRefinements', r => {
    expect(hasAnyRefinement(r)).toBe(true);
    expect(countActiveRefinements(r)).toBe(1);
  });

  it('ignores DP thresholds left at zero or unset', () => {
    expect(hasAnyRefinement({ hasDpContracts: false, dpDaysOver: 0, dpBushelsOver: null, dpChargesOver: 0 } as RefinementFilters)).toBe(false);
  });
});

describe('hiddenRefineFilters', () => {
  const hidden = (q: string) => [...hiddenRefineFilters(q)].sort();

  it('hides nothing for a neutral prompt', () => {
    expect(hidden('all producers')).toEqual([]);
  });

  it('hides the contract status checkboxes an "active contracts" / "no contracts" prompt restates', () => {
    expect(hidden('producers with active contracts')).toEqual(['hasActiveContracts', 'noActiveContracts']);
    // noContractsAtAll is a stricter narrowing and stays visible.
    expect(hidden('producers with no contracts')).toEqual(['hasActiveContracts', 'noActiveContracts']);
  });

  it('hides contact checkboxes for contact prompts', () => {
    expect(hidden('producers never contacted')).toEqual(['neverContacted']);
    expect(hidden('producers not contacted in 30 days')).toEqual(['notContactedDays']);
    expect(hidden('producers i have contacted')).toEqual(['contactedByMeOnly', 'neverContacted']);
    expect(hidden('notes added in the last 7 days')).toEqual(['notesInLastDays']);
    expect(hidden('producers with notes mentioning drought')).toEqual(['hasPinnedNotes', 'neverContacted', 'noteKeyword']);
  });

  it('hides the planting, storage and DP checkboxes their prompts restate', () => {
    expect(hidden('corn planting intentions for 2026')).toEqual(['hasPlantingIntentions', 'plantingCrop', 'plantingYear']);
    expect(hidden('producers with grain stored over 90 days')).toEqual(['hasGrainInStorage', 'storageDaysOver']);
    expect(hidden('producers on dp over 60 days')).toEqual(['dpDaysOver', 'hasDpContracts']);
    expect(hidden('dp charges over 500')).toEqual(['dpChargesOver']);
  });

  it('hides has/no bin sites for a bin-site prompt and the deliveries box for ticket prompts', () => {
    expect(hidden('producers with bin sites')).toEqual(['hasBinSites', 'noBinSites']);
    expect(hidden('producers with unapplied tickets')).toEqual(['hasDeliveriesThisYear']);
    expect(hidden('producers with applied tickets')).toEqual(['hasDeliveriesThisYear']);
  });
});
