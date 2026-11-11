import { describe, it, expect } from 'vitest';
import type { Contract, DashboardPlantingEstimate, PlantingIntention } from '@models';
import { mergeIncomingById, mergeYieldEstimates, yieldEstimateYears } from './production-reads';

describe('production reads', () => {
  describe('mergeIncomingById', () => {
    it('puts incoming rows first and keeps only existing rows the incoming set does not replace', () => {
      const merged = mergeIncomingById([{ id: 'b', v: 2 }, { id: 'c', v: 3 }], [{ id: 'a', v: 0 }, { id: 'b', v: 1 }]);
      expect(merged).toEqual([{ id: 'b', v: 2 }, { id: 'c', v: 3 }, { id: 'a', v: 0 }]);
    });
  });

  describe('yield estimates', () => {
    it('asks for this year, last year and every year an intention or contract carries', () => {
      const intentions = [{ plantingYear: 2027 }, { plantingYear: 0 }] as PlantingIntention[];
      const contracts = [{ cropYear: 2024 }, { cropYear: 2026 }] as Contract[];
      expect(yieldEstimateYears(2026, intentions, contracts)).toEqual([2026, 2025, 2027, 2024]);
    });

    it('keeps one estimate per crop and year, the later batch winning', () => {
      const est = (crop: string, year: number, y: number) =>
        ({ id: 0, tradeUnitKey: 'TU1', crop, plantingYear: year, yieldEstimate: y }) as DashboardPlantingEstimate;
      const merged = mergeYieldEstimates([[est('CORN', 2026, 180), est('CORN', 2025, 170)], [est('CORN', 2026, 190)]]);
      expect(merged.map(e => `${e.crop}|${e.plantingYear}|${e.yieldEstimate}`))
        .toEqual(['CORN|2026|190', 'CORN|2025|170']);
    });
  });

});
