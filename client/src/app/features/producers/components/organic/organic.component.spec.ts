import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Customer } from '@models';
import { CUSTOMER_SCREEN_SOURCE, CustomerScreenLink, SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { OrganicBadgeComponent } from './organic-badge.component';
import { OrganicPanelComponent } from './organic-panel.component';
import { OrganicPanelState } from './organic-panel.state';

/** The badge and its panel as the profile places them: the badge in the badge row, the panel under the name. */
@Component({
  imports: [OrganicBadgeComponent, OrganicPanelComponent],
  template: '<div class="badges"><app-organic-badge /></div><div class="panels"><app-organic-panel /></div>',
})
class ProfileHeaderHost {}

const producer = (over: Partial<Customer> = {}) => ({ id: 1, name: 'Smith Farms', ...over }) as Customer;

// Which producers get the badge is unit-tested in @shared/utils/organic-visibility.spec.ts; these pin that the badge
// and the panel read the selected producer's own fields, and open and close together.
describe('The Organic badge and panel', () => {
  const customer = signal<Customer | null>(null);
  let fixture: ComponentFixture<ProfileHeaderHost>;

  const host = () => fixture.nativeElement as HTMLElement;
  const badge = () => host().querySelector<HTMLButtonElement>('.badges button');
  const panel = () => host().querySelector<HTMLElement>('.panels #organic-certification-panel');
  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  /** The badge closes the panel for each producer in an effect, so a second pass shows the result. */
  const render = () => { fixture.detectChanges(); fixture.detectChanges(); };

  function show(who: Customer | null): void {
    customer.set(who);
    TestBed.configureTestingModule({
      providers: [
        { provide: CUSTOMER_SCREEN_SOURCE, useValue: { customer, linkedCustomers: signal([]), link: signal<CustomerScreenLink>({}) } },
        SelectedCustomerContext,
      ],
    });
    fixture = TestBed.createComponent(ProfileHeaderHost);
    render();
  }

  beforeEach(() => customer.set(null));

  it('shows the badge on the organic industry code alone', () => {
    show(producer({ industryCode2: 'OR' }));
    expect(text(badge())).toContain('Organic');
  });

  it('shows the badge on a real NOP id alone: the five producers coded CV or DA', () => {
    show(producer({ industryCode2: 'CV', nopId: '1234567890' }));
    expect(badge()).not.toBeNull();
  });

  it('shows no badge for a conventional producer, one with neither signal, or no producer', () => {
    show(producer({ industryCode2: 'CV' }));
    expect(badge()).toBeNull();
    customer.set(producer());
    render();
    expect(badge()).toBeNull();
    customer.set(null);
    render();
    expect(badge()).toBeNull();
  });

  it('opens the NOP ID panel from the badge, marked as an open header panel, and closes it again', () => {
    show(producer({ industryCode2: 'OR', nopId: '1234567890' }));
    expect(panel()).toBeNull();
    expect(badge()!.getAttribute('aria-expanded')).toBe('false');

    badge()!.click();
    render();

    expect(badge()!.getAttribute('aria-expanded')).toBe('true');
    expect(text(panel())).toContain('1234567890');

    badge()!.click();
    render();
    expect(panel()).toBeNull();
  });

  it('says when no NOP ID is on file', () => {
    show(producer({ industryCode2: 'OR' }));
    badge()!.click();
    render();
    expect(text(panel())).toContain('No NOP ID on file for this producer.');
  });

  it('starts closed for the next producer', () => {
    show(producer({ industryCode2: 'OR', nopId: '1234567890' }));
    badge()!.click();
    render();
    expect(panel()).not.toBeNull();

    customer.set(producer({ id: 2, industryCode2: 'OR', nopId: '9876543210' }));
    render();

    expect(panel()).toBeNull();
  });

  it('shows no panel for a producer without the badge', () => {
    show(producer({ industryCode2: 'CV' }));
    TestBed.inject(OrganicPanelState).open.set(true);
    render();
    expect(panel()).toBeNull();
  });
});
