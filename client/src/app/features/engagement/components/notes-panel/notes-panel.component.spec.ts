import { describe, it, expect, beforeEach } from 'vitest';
import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Customer, Note } from '@models';
import { CUSTOMER_SCREEN_SOURCE, CustomerScreenLink, SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent } from '@shared/components/card/card.component';
import { SelectedProducerEngagementFake, provideSelectedProducerEngagement, selectedProducerEngagementFake } from '@testing/selected-producer-engagement.fake';
import { NotesPanelComponent } from './notes-panel.component';

/** Stands in for the notes card, which has its own spec. */
@Component({ selector: 'app-customer-notes', template: 'notes card for {{ customer().name }}' })
class StubNotesCard {
  readonly customer = input.required<Customer>();
}

const producer = { id: 1, name: 'Smith Farms' } as Customer;
const note = (createdAt: Date): Note => ({ id: 1, customerId: 1, customerName: 'Smith Farms', content: '', isPinned: false, createdBy: 't', createdAt } as Note);

describe('NotesPanelComponent', () => {
  let engagement: SelectedProducerEngagementFake;
  const customer = signal<Customer | null>(producer);

  function render(): HTMLElement {
    TestBed.configureTestingModule({
      providers: [
        provideSelectedProducerEngagement(engagement),
        { provide: CUSTOMER_SCREEN_SOURCE, useValue: { customer, linkedCustomers: signal([]), link: signal<CustomerScreenLink>({}) } },
        SelectedCustomerContext,
      ],
    });
    TestBed.overrideComponent(NotesPanelComponent, {
      set: { imports: [CardComponent, CardContentComponent, CardHeaderComponent, CardTitleComponent, StubNotesCard] },
    });
    const fixture = TestBed.createComponent(NotesPanelComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (host: HTMLElement) => (host.textContent ?? '').replace(/\s+/g, ' ').trim();

  beforeEach(() => {
    engagement = selectedProducerEngagementFake();
    customer.set(producer);
  });

  it("frames the producer's notes card under a Notes heading", () => {
    const host = render();

    expect(text(host)).toContain('Notes');
    expect(text(host)).toContain('notes card for Smith Farms');
  });

  it('says the producer was never contacted when they have no notes', () => {
    expect(text(render())).toContain('Last contacted: Never');
  });

  it("dates the last contact from the producer's newest note", () => {
    engagement.notes.set([note(new Date())]);

    expect(text(render())).toContain('Last contacted: Today');
  });

  it('shows nothing without a producer', () => {
    customer.set(null);

    expect(text(render())).toBe('');
  });
});
