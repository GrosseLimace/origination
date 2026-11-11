import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChangeDetectorRef, ComponentRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CustomerProfileComponent } from './customer-profile.component';
import { ApiService } from '@core/services/api.service';
import { ThemeService } from '@core/services/theme.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer } from '@models';
import { provideSelectedProducerActivity } from '@testing/selected-producer-activity.fake';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { SelectedProducerProduction } from '@core/context/selected-producer-production';
import { providePermissions } from '@testing/permission.stub';
import { producerProfilesFake, provideProducerProfiles } from '@testing/producer-profiles.fake';
import { provideSelectedProducerProduction, selectedProducerProductionFake } from '@testing/selected-producer-production.fake';

/** The profiles the describes below that don't set their own read: none. */
const profiles = producerProfilesFake();

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 1, scoularId: 'CUST1', name: 'Test Farm', location: 'Omaha, NE',
    phone: '', email: '', eSignEnabled: false, ...over,
  };
}

// The Planting, Storage and DP Contracts tabs rendered inside it read the producer's production from the Producers
// module, through core (ProducerProductionStore's spec covers it): the profile holds none of it.
describe('CustomerProfileComponent — the producer\'s production', () => {
  it('provides none of its own, so what renders inside it reads the app\'s', () => {
    const production = selectedProducerProductionFake();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: {} },
        { provide: ThemeService, useValue: {} },
        provideSelectedProducerActivity(),
        provideSelectedProducerProduction(production),
        provideProducerProfiles(profiles),
        SelectedCustomerContext,
        providePermissions(),
        { provide: UsageTrackingService, useValue: { trackCallClick: () => {}, trackEmailClick: () => {}, postClickEvent: () => {} } },
      ],
    });
    TestBed.overrideComponent(CustomerProfileComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    const fixture = TestBed.createComponent(CustomerProfileComponent);
    fixture.componentRef.setInput('customer', makeCustomer({ id: 42 }));

    expect(fixture.debugElement.injector.get(SelectedProducerProduction)).toBe(production);
  });
});

// Covers the click-to-open-in-Google-Maps address link: which address gets mapped, when the
// link is suppressed, and that opening one is recorded for usage reporting.
describe('CustomerProfileComponent — address map link', () => {
  let component: CustomerProfileComponent;
  let ref: ComponentRef<CustomerProfileComponent>;
  let tracking: { trackMapClick: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tracking = { trackMapClick: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: {} },
        { provide: ThemeService, useValue: {} },
        provideSelectedProducerActivity(),
        provideProducerProfiles(profiles),
        SelectedCustomerContext,
        providePermissions(),
        { provide: UsageTrackingService, useValue: { trackCallClick: () => {}, trackEmailClick: () => {}, postClickEvent: () => {}, ...tracking } },
      ],
    });
    TestBed.overrideComponent(CustomerProfileComponent, {
      set: { template: '', templateUrl: undefined, imports: [] },
    });
    const fixture = TestBed.createComponent(CustomerProfileComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
  });

  it('displays and maps the Extended address, including the ZIP', () => {
    ref.setInput('customer', makeCustomer({
      addressLine1: 'PO Box 5', location: 'Omaha', stateProvince: 'IA',
      extendedAddressLine1: '1234 County Rd 12', extendedCity: 'Hastings',
      extendedStateProvince: 'NE', extendedPostalCode: '68901',
    }));

    expect(component.getContactAddress()).toBe('1234 County Rd 12, Hastings, NE 68901');
    expect(component.getMapsUrl()).toContain('1234%20County%20Rd%2012');
  });

  it('suppresses the link when only a state is known', () => {
    ref.setInput('customer', makeCustomer({ location: '', stateProvince: 'NE' }));

    expect(component.getMapsUrl()).toBeNull();
  });

  it('tracks the click so map opens show up in usage reporting', () => {
    ref.setInput('customer', makeCustomer({ id: 42, location: 'Hastings', stateProvince: 'NE' }));

    component.trackMapClick();

    expect(tracking.trackMapClick).toHaveBeenCalledWith('42');
  });
});

// Covers the bin-site mini-table at the bottom of the Contact column: formatted cells (dashes when
// empty), the exact-point map link only when a site has coordinates, and that the
// table starts collapsed and re-collapses per producer.
// The header's slots and the eSign recipients panel, rendered through the REAL template. The child
// components are dropped (NO_ERRORS_SCHEMA) because only this component's own markup is under test.
// The recipients are derived from the customer input; these pin what they show, that the derivation
// runs once per customer rather than on every change-detection pass, and that it follows the input.
describe('CustomerProfileComponent — header slots and ScoularView recipients (rendered)', () => {
  let fixture: ComponentFixture<CustomerProfileComponent>;
  let component: CustomerProfileComponent;
  let ref: ComponentRef<CustomerProfileComponent>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

  const recipientChips = (): string[] => {
    const label = Array.from(host().querySelectorAll('p')).find(p => p.textContent?.trim() === 'ScoularView Recipients');
    return Array.from(label?.nextElementSibling?.querySelectorAll('span') ?? []).map(s => squash(s.textContent));
  };

  /** A change-detection pass that re-checks this OnPush view without changing any input. Marks the
   *  component's OWN view: marking the fixture's host view leaves an OnPush child unchecked. */
  const rerender = (): void => {
    fixture.debugElement.injector.get(ChangeDetectorRef).markForCheck();
    fixture.detectChanges();
  };

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: {} },
        { provide: ThemeService, useValue: {} },
        provideSelectedProducerActivity(),
        provideProducerProfiles(profiles),
        SelectedCustomerContext,
        providePermissions(),
        { provide: UsageTrackingService, useValue: { trackCallClick: () => {}, trackEmailClick: () => {}, postClickEvent: () => {} } },
      ],
    });
    TestBed.overrideComponent(CustomerProfileComponent, {
      set: { imports: [CommonModule], schemas: [NO_ERRORS_SCHEMA] },
    });
    fixture = TestBed.createComponent(CustomerProfileComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
  });

  // Producers fills them: the Organic badge and its panel, the Insights button, Print and Edit, the contacts, the bin
  // sites, Farm Details, Harvest Contract Pace, and the Insights panels and Activity Summary. Lists adds Add to List.
  it("hosts the modules' panels where the producer's details and summaries sat", () => {
    ref.setInput('customer', makeCustomer({ eSignEnabled: true, phone: '4025550100', email: 'office@farm.com' }));
    fixture.detectChanges();
    const slot = (name: string) => host().querySelector(`app-customer-slot[slot="${name}"]`)!;
    const heading = (title: string) => Array.from(host().querySelectorAll('h3')).find(h => h.textContent?.trim() === title)!;
    const contactColumn = heading('Contact and Locations').nextElementSibling!;

    expect(squash(slot('badges').parentElement!.textContent)).toContain('eSign');
    expect(slot('badge-panels')).not.toBeNull();
    expect(contactColumn.firstElementChild).toBe(slot('contacts'));
    expect(contactColumn.lastElementChild).toBe(slot('locations'));
    expect(squash(contactColumn.textContent)).toContain('office@farm.com');
    // The details row: Contact and Locations, then the modules' details.
    expect(slot('details').previousElementSibling).toBe(contactColumn.parentElement);
    expect(slot('details').nextElementSibling).toBeNull();
    // The actions sit in the row under the name, before the linked-producer picker.
    expect(slot('actions').parentElement!.classList).toContain('flex-wrap');
    // The toolbar is the header's buttons, all of them the modules': Add to List, Print and Edit are no longer the
    // profile's own.
    expect(slot('toolbar').parentElement!.children).toHaveLength(1);
    expect(squash(host().textContent)).not.toContain('Add to List');
    expect(host().querySelector('button[title="Print"]')).toBeNull();
    expect(Array.from(host().querySelectorAll('button')).some(b => squash(b.textContent) === 'Edit')).toBe(false);
    expect(host().querySelector('app-edit-customer-dialog')).toBeNull();
    // The summary sits between the header card and the tabs, in a column spaced by its gap.
    expect(slot('summary').parentElement!.className).toContain('gap-8');
    expect(squash(slot('summary').previousElementSibling!.textContent)).toContain('Contact and Locations');
    expect(slot('summary').nextElementSibling!.querySelector('.rounded-full')).not.toBeNull();
  });

  it('splits the ScoularView recipients on the commas between complete entries', () => {
    ref.setInput('customer', makeCustomer({
      eSignEnabled: true,
      scoularViewRecipients: 'Ade, Clay 785-555-1234, Bo Smith 402-555-9876,  , Trailing Note',
    }));
    fixture.detectChanges();
    component.showESignRecipients.set(true);
    fixture.detectChanges();

    expect(recipientChips()).toEqual(['Ade, Clay 785-555-1234', 'Bo Smith 402-555-9876, Trailing Note']);
  });

  it('parses the recipients once per customer, and again when the customer changes', () => {
    const parse = vi.spyOn(component, 'parseRecipients');
    ref.setInput('customer', makeCustomer({ eSignEnabled: true, scoularViewRecipients: 'Al 402-555-0001' }));
    fixture.detectChanges();
    component.showESignRecipients.set(true);
    fixture.detectChanges();
    rerender();
    rerender();

    expect(parse).toHaveBeenCalledTimes(1);
    expect(recipientChips()).toEqual(['Al 402-555-0001']);

    ref.setInput('customer', makeCustomer({ eSignEnabled: true, scoularViewRecipients: 'Bea 402-555-0002, Cy 402-555-0003' }));
    fixture.detectChanges();
    component.showESignRecipients.set(true);   // switching customers closes the panel
    fixture.detectChanges();

    expect(recipientChips()).toEqual(['Bea 402-555-0002', 'Cy 402-555-0003']);
    expect(parse).toHaveBeenCalledTimes(2);
  });
});
