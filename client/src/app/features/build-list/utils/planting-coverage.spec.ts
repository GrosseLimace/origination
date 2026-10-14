import { describe, it, expect } from 'vitest';
import { Commodity, Contract, Customer, DashboardPlantingEstimate, PlantingIntention } from '@models';
import { evaluatePlantingCoverage, PlantingCoverageInput } from './planting-coverage';

const customer = (id: number): Customer => ({
  id, name: `P${id}`, scoularId: `C${id}`, farm: '', location: '', phone: '', email: '', totalAcres: 0,
  linkedProducerIds: [], eSignEnabled: false, achEnabled: false,
});
const contract = (over: Partial<Contract>): Contract => ({
  id: 1, customerId: 1, ctrmCustomerId: 'C1', sourceContractId: 'P1', farmId: 'F', contractNumber: '1', contractPrefixType: 'P',
  commodityCode: 'YC', commodityDescription: 'Corn', commodityGroup: 'Corn', quantity: 0, unit: 'bushels', price: 0,
  status: 'Active', signed: true, cropYear: 2026, ...over,
});
const planting = (customerId: number, crop: string, acres: number, over: Partial<PlantingIntention> = {}) =>
  ({ id: customerId, customerId, crop, acres, plantingYear: 2026, ...over }) as PlantingIntention;
const estimate = (crop: string, yieldEstimate: number, plantingYear = 2026): DashboardPlantingEstimate =>
  ({ id: 1, tradeUnitKey: '1000', crop, plantingYear, yieldEstimate });

const COMMODITIES: Commodity[] = [
  { id: 1, code: 'YC', name: 'Yellow Corn', category: 'Corn', isActive: true },
  { id: 2, code: 'SB', name: 'Soybeans', category: 'Soybeans', isActive: true },
  { id: 3, code: 'OSB', name: 'Organic Soybeans', category: 'Soybeans', plantingCategory: 'Organic Soybeans', isActive: true },
  { id: 4, code: 'SBM', name: 'Soybean Meal', category: 'Soybeans', isActive: true },
];

function input(over: Partial<PlantingCoverageInput> = {}): PlantingCoverageInput {
  return {
    intentions: [planting(1, 'YC', 100), planting(2, 'SB', 50)],
    customers: [customer(1), customer(2), customer(3)],
    contractBatches: [[contract({ ctrmCustomerId: 'C1', quantity: 10000 })]],
    estimateBatches: [[estimate('Corn', 200), estimate('Soybeans', 50)]],
    commodities: COMMODITIES,
    commodityConversions: [{ commodityCode: 'SBM', lbsPerUnit: 60 }],
    ...over,
  };
}
const ids = (r: { customers: Customer[] | null }) => r.customers?.map(c => c.id) ?? null;

describe('evaluatePlantingCoverage', () => {
  it('returns null customers for a prompt that is none of the three phrasings', () => {
    expect(evaluatePlantingCoverage('producers over 50 percent contracted', input()).customers).toBeNull();
  });

  describe('planting with no contracts', () => {
    it('keeps producers with a planted crop+year no contract covers', () => {
      expect(ids(evaluatePlantingCoverage('producers with planting and no contracts', input()))).toEqual([2]);
      expect(ids(evaluatePlantingCoverage('planting with no active contracts', input()))).toEqual([2]);
    });

    it('matches contracts by resolved category and crop year — not substrings, not other years', () => {
      const r = evaluatePlantingCoverage('planting no contract', input({
        contractBatches: [[
          contract({ ctrmCustomerId: 'C1', commodityCode: 'CKYC', commodityGroup: 'Cracked Corn', commodityDescription: 'Cracked corn' }),
          contract({ ctrmCustomerId: 'C2', commodityCode: 'SB', commodityGroup: 'Soybeans', cropYear: 2025 }),
        ]],
      }));
      expect(ids(r)).toEqual([1, 2]);
    });

    it('an organic planting row is covered by organic contracts only', () => {
      const r = evaluatePlantingCoverage('planting no contract', input({
        intentions: [planting(1, 'OSB', 10)],
        contractBatches: [[contract({ ctrmCustomerId: 'C1', commodityCode: 'SB', commodityGroup: 'Soybeans' })]],
      }));
      expect(ids(r)).toEqual([1]);
    });
  });

  describe('under N percent contracted', () => {
    it('compares contracted bushels with acres x the season yield target', () => {
      // P1: 10,000 of 20,000 bu = 50%. P2: 0 of 2,500 bu.
      expect(ids(evaluatePlantingCoverage('under 50 percent contracted', input()))).toEqual([2]);
      expect(ids(evaluatePlantingCoverage('under 51 percent contracted', input()))).toEqual([1, 2]);
    });

    it('defaults to 50% when no number is given', () => {
      expect(ids(evaluatePlantingCoverage('producers under percent contracted', input()))).toEqual([2]);
    });

    it('converts weight-priced contracts to bushels', () => {
      // 60 lb/bu: a 120,000 lb SBM contract is 2,000 bu of P2's 2,500 — 80%, so P2 drops off. Without a
      // conversion factor the contract can't be counted and P2 would stay at 0%.
      const r = evaluatePlantingCoverage('under 50 percent contracted', input({
        contractBatches: [[
          contract({ ctrmCustomerId: 'C1', quantity: 10000 }),
          contract({ ctrmCustomerId: 'C2', commodityCode: 'SBM', commodityGroup: 'Soybeans', unit: 'LB', quantity: 120000 }),
        ]],
      }));
      expect(ids(r)).toEqual([]);
    });

    it('counts the rows it evaluated and the ones with a target', () => {
      const r = evaluatePlantingCoverage('under 50 percent contracted', input({ estimateBatches: [[estimate('Corn', 200, 2025)]] }));
      expect(ids(r)).toEqual([]);
      expect(r.plantingRowsEvaluated).toBe(2);
      expect(r.plantingRowsWithEstimate).toBe(0);
    });
  });

  describe('highest uncontracted bushels', () => {
    it('ranks by the gap, largest first, top 10 only', () => {
      // P1 gap 10,000 bu; P2 gap 2,500 bu.
      expect(ids(evaluatePlantingCoverage('highest uncontracted bushels', input()))).toEqual([1, 2]);

      const many = Array.from({ length: 12 }, (_, i) => customer(i + 1));
      const r = evaluatePlantingCoverage('uncontracted', input({
        customers: many,
        intentions: many.map(c => planting(c.id, 'YC', c.id)),
        contractBatches: [[]],
      }));
      expect(ids(r)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    });

    it('leaves out producers with no gap', () => {
      const r = evaluatePlantingCoverage('uncontracted', input({
        contractBatches: [[contract({ ctrmCustomerId: 'C1', quantity: 99999 })]],
      }));
      expect(ids(r)).toEqual([2]);
      expect(r.plantingRowsWithEstimate).toBe(2);
    });
  });
});
