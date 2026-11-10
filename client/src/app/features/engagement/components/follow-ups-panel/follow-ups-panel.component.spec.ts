import { describe, it, expect, beforeEach } from 'vitest';
import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Customer } from '@models';
import { CUSTOMER_SCREEN_SOURCE, CustomerScreenLink, SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { CardComponent } from '@shared/components/card/card.component';
import { provideSelectedProducerEngagement, selectedProducerEngagementFake } from '@testing/selected-producer-engagement.fake';
import { FollowUpsPanelComponent } from './follow-ups-panel.component';

/** Stands in for the follow-ups card, which has its own spec. */
@Component({ selector: 'app-customer-reminders', template: 'follow-ups for {{ customer().name }}' })
class StubFollowUpsCard {
  readonly customer = input.required<Customer>();
}

const producer = { id: 1, name: 'Smith Farms' } as Customer;

describe('FollowUpsPanelComponent', () => {
  const customer = signal<Customer | null>(producer);

  function render(remindersEnabled = true): string {
    TestBed.configureTestingModule({
      providers: [
        provideSelectedProducerEngagement({ ...selectedProducerEngagementFake(), remindersEnabled }),
        { provide: CUSTOMER_SCREEN_SOURCE, useValue: { customer, linkedCustomers: signal([]), link: signal<CustomerScreenLink>({}) } },
        SelectedCustomerContext,
      ],
    });
    TestBed.overrideComponent(FollowUpsPanelComponent, { set: { imports: [CardComponent, StubFollowUpsCard] } });
    const fixture = TestBed.createComponent(FollowUpsPanelComponent);
    fixture.detectChanges();
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').trim();
  }

  beforeEach(() => customer.set(producer));

  it("shows the user's follow-ups card for the producer", () => {
    expect(render()).toBe('follow-ups for Smith Farms');
  });

  it('shows nothing where follow-ups are switched off', () => {
    expect(render(false)).toBe('');
  });

  it('shows nothing without a producer', () => {
    customer.set(null);

    expect(render()).toBe('');
  });
});
