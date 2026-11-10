import { Provider, signal } from '@angular/core';
import { vi } from 'vitest';
import { Contract } from '@models';
import { ContractPacingHistoryStore } from './contract-pacing-history.store';

/**
 * A ContractPacingHistoryStore for specs: the history and its failure as writable signals, the same whichever producer
 * asks, and `load` as a spy.
 */
export function contractPacingHistoryFake() {
  const contracts = signal<Contract[]>([]);
  const failed = signal(false);
  return {
    contracts,
    failed,
    load: vi.fn(),
    contractsFor: () => contracts.asReadonly(),
    failedFor: () => failed.asReadonly(),
  };
}

export type ContractPacingHistoryFake = ReturnType<typeof contractPacingHistoryFake>;

/** Provides `fake` as the ContractPacingHistoryStore. */
export function provideContractPacingHistory(fake: ContractPacingHistoryFake): Provider {
  return { provide: ContractPacingHistoryStore, useValue: fake };
}
