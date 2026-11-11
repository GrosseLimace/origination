import { describe, it, expect } from 'vitest';
import { Contract, Customer, Ticket } from '@models';
import { producerContractsAndTickets, readFailureMessage } from './producer-activity';

const customer = (id: number) => ({ id, scoularId: `S-${id}`, name: `P${id}` }) as Customer;

describe('producer activity', () => {
  describe('readFailureMessage', () => {
    it('names a CTRM outage with the server\'s own message, or a default when it has none', () => {
      expect(readFailureMessage({ status: 503, error: { code: 'INFRASTRUCTURE_CTRM_UNAVAILABLE', message: 'Down.' } }))
        .toBe('Down.');
      expect(readFailureMessage({ status: 503, error: { code: 'INFRASTRUCTURE_CTRM_UNAVAILABLE' } }))
        .toBe('CTRM is temporarily unavailable. Please retry shortly.');
    });

    it('calls any other 503 a data-source outage and everything else a generic failure', () => {
      expect(readFailureMessage({ status: 503 })).toBe('The data source is temporarily unavailable. Please retry shortly.');
      expect(readFailureMessage({ status: 500 })).toBe('Something went wrong loading this data. Please retry.');
      expect(readFailureMessage(null)).toBe('Something went wrong loading this data. Please retry.');
    });
  });

  describe('producerContractsAndTickets', () => {
    it('keeps the producer\'s contracts, its own tickets, and split-load tickets applied to its contracts', () => {
      const contracts = [
        { id: 1, ctrmCustomerId: 'S-1', sourceContractId: 'P1' },
        { id: 2, ctrmCustomerId: 'S-2', sourceContractId: 'P2' },
      ] as Contract[];
      const tickets = [
        { id: 10, customerCode: 'S-1' },
        { id: 11, customerCode: 'S-X', ctrmContractNumber: 'P1' },
        { id: 12, customerCode: 'S-X', ctrmContractNumber: 'P2' },
        { id: 13, customerCode: 'S-2' },
      ] as Ticket[];
      const rows = producerContractsAndTickets(customer(1), contracts, tickets);
      expect(rows.contracts.map(c => c.id)).toEqual([1]);
      expect(rows.tickets.map(t => t.id)).toEqual([10, 11]);
    });
  });
});
