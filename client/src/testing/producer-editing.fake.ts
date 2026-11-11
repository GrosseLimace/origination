import { Provider, signal } from '@angular/core';
import { vi } from 'vitest';
import { Customer } from '@models';
import { ProducerEditing } from '@core/context/producer-editing';

/**
 * A ProducerEditing for specs: writable signals a test sets directly, and a spy for the save. Starts with no producers,
 * no trade units and nothing saving.
 */
export function producerEditingFake() {
  return {
    producers: signal<Customer[]>([]),
    producersTradeUnits: signal<string[]>([]),
    saving: signal(false),
    save: vi.fn(),
  } satisfies ProducerEditing;
}

export type ProducerEditingFake = ReturnType<typeof producerEditingFake>;

/** Provides `fake` (or an empty one) as the ProducerEditing. */
export function provideProducerEditing(fake: ProducerEditingFake = producerEditingFake()): Provider {
  return { provide: ProducerEditing, useValue: fake };
}
