import { Provider, signal } from '@angular/core';
import { vi } from 'vitest';
import { Contract, ContractPricingLine, Ticket } from '@models';
import { SelectedProducerActivity } from '@core/context/selected-producer-activity';

/**
 * A SelectedProducerActivity for specs: writable signals a test sets directly, and Retry spies. Starts with no
 * producer data, nothing loading and no failures.
 */
export function selectedProducerActivityFake() {
  return {
    contracts: signal<Contract[]>([]),
    tickets: signal<Ticket[]>([]),
    pricingLines: signal<ContractPricingLine[]>([]),
    isLoadingContracts: signal(false),
    isLoadingTickets: signal(false),
    isLoadingPricingLines: signal(false),
    contractsLoadError: signal<string | null>(null),
    ticketsLoadError: signal<string | null>(null),
    pricingLinesLoadError: signal<string | null>(null),
    retryContracts: vi.fn(),
    retryTickets: vi.fn(),
  } satisfies SelectedProducerActivity;
}

export type SelectedProducerActivityFake = ReturnType<typeof selectedProducerActivityFake>;

/** Provides `fake` (or an empty one) as the SelectedProducerActivity. */
export function provideSelectedProducerActivity(fake: SelectedProducerActivityFake = selectedProducerActivityFake()): Provider {
  return { provide: SelectedProducerActivity, useValue: fake };
}
