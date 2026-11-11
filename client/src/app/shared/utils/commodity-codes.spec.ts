import { describe, it, expect } from 'vitest';
import type { Contract, Ticket } from '@models';
import { commodityCodesFrom } from './commodity-codes';

describe('commodity codes', () => {
  describe('commodityCodesFrom', () => {
    it('lists distinct ticket product codes then contract commodity codes, skipping blanks', () => {
      const tickets = [{ productCode: 'SB' }, { productCode: '' }, { productCode: 'C' }, { productCode: 'SB' }] as Ticket[];
      const contracts = [{ commodityCode: 'C' }, { commodityCode: 'W' }, {}] as Contract[];
      expect(commodityCodesFrom(tickets, contracts)).toEqual(['SB', 'C', 'W']);
    });
  });
});
