import { describe, it, expect } from 'vitest';
import { FieldSeason } from '@models';
import { estimateCi, fdCicCropFor, missingInputs, nationalAverage, summarizeIntention, yieldUsed } from './ci-illustrative';

function season(overrides: Partial<FieldSeason> = {}): FieldSeason {
  return {
    id: 's1', fieldKey: 'f1', plantingIntentionId: 1, acres: 100,
    expectedYield: 200, actualYield: null, syntheticN: 195.48, niFraction: 0,
    tillage: 'Conventional', coverCrop: 'None', manure: [], status: 'Draft',
    ...overrides,
  };
}

describe('ci-illustrative (prototype)', () => {
  it('should map planting crop labels to FD-CIC crops', () => {
    expect(fdCicCropFor('Irrigated Corn')).toBe('Corn');
    expect(fdCicCropFor('Organic Soybeans')).toBe('Soybean');
    expect(fdCicCropFor('Milo')).toBe('Sorghum');
    expect(fdCicCropFor('Canola')).toBe('Canola');
    expect(fdCicCropFor('Popcorn')).toBeNull();
    expect(fdCicCropFor('Hard Red Winter Wheat')).toBeNull();
  });

  it('should use the FD-CIC v1.0 national average for corn', () => {
    expect(nationalAverage('Corn')).toBeCloseTo(6030.65, 2);
  });

  it('should clamp the yield used to 80–120% of expected, using expected before harvest', () => {
    expect(yieldUsed(200, null)).toBe(200);
    expect(yieldUsed(200, 100)).toBe(160);
    expect(yieldUsed(200, 300)).toBe(240);
    expect(yieldUsed(200, 210)).toBe(210);
  });

  it('should list missing inputs and not score until they are filled', () => {
    const blank = season({ expectedYield: null, syntheticN: null, tillage: null, coverCrop: null });
    expect(missingInputs(blank)).toEqual(['expected yield', 'nitrogen rate', 'tillage', 'cover crop']);
    expect(estimateCi('Corn', blank)).toBeNull();
  });

  it('should score a conventional field at the national N rate at the national average', () => {
    // 195.48 lbs N on 200 bu is the corn N threshold (0.9774 lbs/bu), so every component is national.
    const r = estimateCi('Corn', season())!;
    expect(r.ciGPerBu).toBeCloseTo(6030.65, 1);
    expect(r.vsNational).toBeCloseTo(0, 4);
  });

  it('should lower the score for no-till, cover crop and an inhibitor, and explain each', () => {
    const r = estimateCi('Corn', season({ tillage: 'NoTill', coverCrop: 'CoverCrop', niFraction: 0.5 }))!;
    expect(r.ciGPerBu).toBeLessThan(6030.65);
    const labels = r.reasons.map(x => x.label);
    expect(labels).toEqual(expect.arrayContaining(['No-till', 'Cover crop', 'Nitrification inhibitor']));
    expect(r.reasons.every(x => x.delta < 0)).toBe(true);
  });

  it('should count unassigned acres at the national average in the producer roll-up', () => {
    const lowCi = season({ tillage: 'NoTill', coverCrop: 'CoverCrop' });
    const fieldCi = estimateCi('Corn', lowCi)!.ciGPerBu;

    const fullyAssigned = summarizeIntention('Corn', { id: 1, acres: 100 }, [lowCi]);
    expect(fullyAssigned.ciGPerBu).toBeCloseTo(fieldCi, 6);

    // Half the intention in fields: the roll-up sits halfway between the field and national.
    const half = summarizeIntention('Corn', { id: 1, acres: 200 }, [lowCi]);
    expect(half.ciGPerBu).toBeCloseTo((fieldCi + 6030.65) / 2, 1);
    expect(half.assignedAcres).toBe(100);
  });

  it('should report status: not started, draft while anything is missing, final when all are final', () => {
    expect(summarizeIntention('Corn', { id: 1, acres: 100 }, []).status).toBe('NotStarted');
    expect(summarizeIntention('Corn', { id: 1, acres: 100 }, [season(), season({ id: 's2', tillage: null })]).status).toBe('Draft');
    expect(summarizeIntention('Corn', { id: 1, acres: 100 }, [season()]).status).toBe('Projected');
    expect(summarizeIntention('Corn', { id: 1, acres: 100 }, [season({ status: 'Final', actualYield: 200 })]).status).toBe('Final');
  });
});
