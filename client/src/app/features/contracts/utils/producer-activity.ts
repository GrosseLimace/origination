import { Contract, Customer, Ticket } from '@models';

// ── Load failures ───────────────────────────────────────────────────────────

/**
 * Turns a failed HTTP response into something an originator can act on.
 *
 * The API answers a failed CTRM read with a 503 and ProblemDetails carrying
 * INFRASTRUCTURE_CTRM_UNAVAILABLE, which is the case worth naming: the data exists, we could not reach
 * it, and retrying is the right move. Anything else gets a generic line rather than a raw status.
 */
export function readFailureMessage(err: unknown): string {
  const e = err as { status?: number; error?: { code?: string; message?: string } } | null;
  if (e?.error?.code === 'INFRASTRUCTURE_CTRM_UNAVAILABLE')
    return e.error.message ?? 'CTRM is temporarily unavailable. Please retry shortly.';
  if (e?.status === 503) return 'The data source is temporarily unavailable. Please retry shortly.';
  return 'Something went wrong loading this data. Please retry.';
}

/** The contracts and tickets that belong on one producer's profile. */
export function producerContractsAndTickets(
  customer: Customer, contracts: Contract[], tickets: Ticket[]
): { contracts: Contract[]; tickets: Ticket[] } {
  const allContracts = contracts.filter(c => c.ctrmCustomerId === customer.scoularId);
  // Include tickets whose CustomerCode matches the customer (covers unapplied + same-customer
  // applied) AND tickets whose CtrmContractNumber is on one of this customer's contracts
  // (covers cross-entity / split-load tickets where the ticket's CustomerCode differs from
  // the contract's CtrmCustomerId — the backend now returns these; this filter must let them through).
  const customerContractIds = new Set(
    allContracts.map(c => c.sourceContractId).filter((s): s is string => !!s)
  );
  const allTickets = tickets.filter(t =>
    t.customerCode === customer.scoularId
    || (!!t.ctrmContractNumber && customerContractIds.has(t.ctrmContractNumber))
  );
  return { contracts: allContracts, tickets: allTickets };
}
