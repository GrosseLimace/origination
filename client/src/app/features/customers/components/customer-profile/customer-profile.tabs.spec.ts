import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { Customer } from '@models';
import { ApiService } from '@core/services/api.service';
import { ThemeService } from '@core/services/theme.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { CUSTOMER_SCREEN_SOURCE, CustomerScreenLink, SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { CustomerTab, ModuleManifest } from '@core/modules/module-manifest';
import { APP_MODULES } from '@core/modules/module-registry';
import { PermissionStub, permissionStub, providePermissions } from '@testing/permission.stub';
import { provideSelectedProducerActivity } from '@testing/selected-producer-activity.fake';
import { CustomerProfileComponent } from './customer-profile.component';

const producer = { id: 1, scoularId: 'CUST1', name: 'Test Farm', farm: '', location: '', phone: '', email: '', totalAcres: 0, linkedProducerIds: [], eSignEnabled: false, achEnabled: false } as Customer;
const component = () => Promise.resolve(class {});

/** A module contributing two tabs around the profile's own Planting (30), Storage (40) and DP (50). */
const contracts: CustomerTab = { id: 'contracts', requires: ['contracts:read'], label: 'Open Contracts', shortLabel: 'Cont', order: 10, badge: () => signal(3), component };
const tickets: CustomerTab = { id: 'tickets', requires: ['tickets:read'], segments: ['Producer'], label: 'Unapplied Tickets', shortLabel: 'Tick', order: 20, component };
const extra: CustomerTab = { id: 'extra', requires: [], label: 'Extra', shortLabel: 'Ext', order: 35, component };
const modules: ModuleManifest[] = [{ id: 'contracts', customerTabs: [extra, tickets, contracts] }];

describe("CustomerProfileComponent: the tab strip, with the modules' tabs", () => {
  let fixture: ComponentFixture<CustomerProfileComponent>;
  let profile: CustomerProfileComponent;
  let access: PermissionStub;
  const customer = signal<Customer | null>(producer);
  const link = signal<CustomerScreenLink>({});

  function create(granted: Parameters<typeof permissionStub>[0] = ['contracts:read', 'tickets:read']): void {
    access = permissionStub(granted);
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { getHistoricalContractsForPacing: () => of([]) } },
        { provide: ThemeService, useValue: { isDarkMode: () => false } },
        { provide: UsageTrackingService, useValue: { trackPlantingTabClick: () => {}, trackStorageDropdownOpen: () => {}, trackDpContractsDropdownOpen: () => {} } },
        { provide: APP_MODULES, useValue: modules },
        providePermissions(access),
        provideSelectedProducerActivity(),
        { provide: CUSTOMER_SCREEN_SOURCE, useValue: { customer, link } },
        SelectedCustomerContext,
      ],
    });
    // The class logic is under test; the template and its children are covered elsewhere.
    TestBed.overrideComponent(CustomerProfileComponent, { set: { template: '', templateUrl: undefined, imports: [] } });
    fixture = TestBed.createComponent(CustomerProfileComponent);
    profile = fixture.componentInstance;
    fixture.componentRef.setInput('customer', producer);
    fixture.detectChanges();
  }

  beforeEach(() => {
    customer.set(producer);
    link.set({});
  });

  it("puts the modules' tabs and its own in one strip, in order, with their counts", () => {
    create();

    expect(profile.tabs().map(tab => tab.id)).toEqual(['contracts', 'tickets', 'planting', 'extra', 'storage', 'dpContracts']);
    expect(profile.tabs().find(tab => tab.id === 'contracts')?.count).toBe(3);
    // A module tab without a badge shows no count; the profile's own always count.
    expect(profile.tabs().find(tab => tab.id === 'tickets')?.count).toBeNull();
    expect(profile.tabs().find(tab => tab.id === 'storage')?.count).toBe(0);
  });

  it("leaves out a module's tab the user lacks the permissions for, and adds it once they hold them", () => {
    create(['contracts:read']);
    expect(profile.tabs().map(tab => tab.id)).not.toContain('tickets');

    access.grant('contracts:read', 'tickets:read');

    expect(profile.tabs().map(tab => tab.id)).toContain('tickets');
  });

  it("leaves out a segment's tab when the customer isn't in it", () => {
    create();
    customer.set(null);

    expect(profile.tabs().map(tab => tab.id)).not.toContain('tickets');
    expect(profile.tabs().map(tab => tab.id)).toContain('contracts');
  });

  it("shows the first tab when the one picked isn't in the strip", () => {
    create(['tickets:read']);

    // Open Contracts is the default pick, but this user can't see it.
    expect(profile.shownTab()).toBe('tickets');

    access.grant('contracts:read', 'tickets:read');

    expect(profile.shownTab()).toBe('contracts');
  });

  it("shows a module tab from its contribution, and the profile's own tabs from its template", () => {
    create();

    expect(profile.shownContribution()).toBe(contracts);

    profile.selectTab('extra');
    expect(profile.shownContribution()).toBe(extra);

    profile.selectTab('planting');
    expect(profile.shownTab()).toBe('planting');
    expect(profile.shownContribution()).toBeNull();
  });

  it('opens Open Contracts for a deep link to a contract', () => {
    create();
    profile.selectTab('planting');
    fixture.detectChanges();

    link.set({ contractId: 55 });
    fixture.detectChanges();

    expect(profile.shownTab()).toBe('contracts');
  });

  it('tells the page to give the screen its full width while a tab asks for it', () => {
    create();
    const wide: boolean[] = [];
    profile.onContractsWideChange.subscribe(value => wide.push(value));

    TestBed.inject(SelectedCustomerContext).wideContent.set(true);
    fixture.detectChanges();
    TestBed.inject(SelectedCustomerContext).wideContent.set(false);
    fixture.detectChanges();

    expect(wide.slice(-2)).toEqual([true, false]);
  });
});
