import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Component, ErrorHandler, inject, signal } from '@angular/core';
import { render, screen } from '@testing-library/angular';
import { Customer } from '@models';
import { AppStateService } from '@core/services/app-state.service';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { PermissionStub, permissionStub, providePermissions } from '@testing/permission.stub';
import { CustomerPanel, ModuleManifest } from './module-manifest';
import { APP_MODULES } from './module-registry';
import { CustomerSlotComponent } from './customer-slot.component';

@Component({ selector: 'test-organic', template: 'Organic' })
class OrganicBadge {}

@Component({ selector: 'test-esign', template: 'eSign' })
class ESignBadge {}

@Component({ selector: 'test-farm', template: 'Farm Details' })
class FarmDetails {}

/** A panel that reads the customer the way every contribution does. */
@Component({ selector: 'test-customer-name', template: 'Showing {{ context.customer()?.name }}' })
class CustomerName {
  readonly context = inject(SelectedCustomerContext);
}

/** Stands in for the home page: provides the context for its view, and hosts two slots. */
@Component({
  imports: [CustomerSlotComponent],
  providers: [SelectedCustomerContext],
  template: `
    <div data-testid="badges"><app-customer-slot slot="badges" /></div>
    <div data-testid="details"><app-customer-slot slot="details" /></div>
  `,
})
class Page {}

const panel = (slot: CustomerPanel['slot'], id: string, order: number, type: unknown, extra: Partial<CustomerPanel> = {}): CustomerPanel =>
  ({ slot, id, order, requires: [], component: () => Promise.resolve(type as never), ...extra });

const text = (testId: string) => screen.getByTestId(testId).textContent!.replace(/\s+/g, ' ').trim();

describe('CustomerSlotComponent', () => {
  const selectedCustomer = signal<Customer | null>(null);
  const handleError = vi.fn();

  beforeEach(() => {
    selectedCustomer.set(null);
    handleError.mockClear();
  });

  async function renderPage(modules: ModuleManifest[], access: PermissionStub = permissionStub()) {
    return render(Page, {
      providers: [
        { provide: APP_MODULES, useValue: modules },
        providePermissions(access),
        { provide: AppStateService, useValue: { selectedCustomer } },
        { provide: ErrorHandler, useValue: { handleError } },
      ],
    });
  }

  it("shows its slot's panels from every module, in order, and no other slot's", async () => {
    await renderPage([
      { id: 'producers', customerPanels: [panel('badges', 'organic', 20, OrganicBadge), panel('details', 'farm', 30, FarmDetails)] },
      { id: 'customers', customerPanels: [panel('badges', 'esign', 10, ESignBadge)] },
    ]);

    await screen.findByText('Organic');
    await screen.findByText('eSign');
    expect(text('badges')).toBe('eSignOrganic');
    expect(text('details')).toBe('Farm Details');
  });

  it('leaves out a panel the user lacks the permissions for, and shows it once they hold them', async () => {
    const access = permissionStub();
    const { fixture } = await renderPage([{
      id: 'producers',
      customerPanels: [panel('badges', 'esign', 10, ESignBadge), panel('badges', 'organic', 20, OrganicBadge, { requires: ['producer-details:read'] })],
    }], access);

    await screen.findByText('eSign');
    expect(screen.queryByText('Organic')).toBeNull();

    access.grant('producer-details:read');
    fixture.detectChanges();

    await screen.findByText('Organic');
    expect(text('badges')).toBe('eSignOrganic');
  });

  it("shows a segment's panel only once a customer of that segment is selected", async () => {
    const { fixture } = await renderPage([{
      id: 'producers',
      customerPanels: [
        panel('badges', 'esign', 10, ESignBadge),
        panel('badges', 'organic', 20, OrganicBadge, { segments: ['Producer'] }),
        panel('details', 'farm', 30, FarmDetails, { segments: ['Commercial'] }),
      ],
    }]);

    await screen.findByText('eSign');
    expect(screen.queryByText('Organic')).toBeNull();

    selectedCustomer.set({ id: 1, name: 'Alpha Acres' } as Customer);
    fixture.detectChanges();

    await screen.findByText('Organic');
    // Every customer is a producer for now, so a commercial-only panel never shows.
    expect(screen.queryByText('Farm Details')).toBeNull();
  });

  it("gives its panels the customer the page's context holds", async () => {
    selectedCustomer.set({ id: 1, name: 'Alpha Acres' } as Customer);
    const { fixture } = await renderPage([{ id: 'producers', customerPanels: [panel('details', 'name', 10, CustomerName)] }]);

    await screen.findByText('Showing Alpha Acres');

    selectedCustomer.set({ id: 2, name: 'Bravo Grain' } as Customer);
    fixture.detectChanges();

    await screen.findByText('Showing Bravo Grain');
  });

  it("loads a panel's code once, however often the customer changes", async () => {
    const load = vi.fn(() => Promise.resolve(OrganicBadge as never));
    const { fixture } = await renderPage([{ id: 'producers', customerPanels: [{ slot: 'badges', id: 'organic', order: 10, requires: [], component: load }] }]);
    await screen.findByText('Organic');

    for (const name of ['Alpha Acres', 'Bravo Grain']) {
      selectedCustomer.set({ id: name.length, name } as Customer);
      fixture.detectChanges();
      await fixture.whenStable();
    }

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reports a panel whose code fails to load, and still shows the slot's others", async () => {
    const failure = new Error('Failed to fetch dynamically imported module');
    await renderPage([{
      id: 'producers',
      customerPanels: [
        { slot: 'badges', id: 'broken', order: 10, requires: [], component: () => Promise.reject(failure) },
        panel('badges', 'organic', 20, OrganicBadge),
      ],
    }]);

    await screen.findByText('Organic');
    expect(handleError).toHaveBeenCalledWith(failure);
    expect(text('badges')).toBe('Organic');
  });

  it('renders nothing, and takes no space, when no module contributes to it', async () => {
    await renderPage([]);

    const slot = screen.getByTestId('badges').querySelector('app-customer-slot')!;
    expect(slot.children).toHaveLength(0);
    expect(slot.classList).toContain('contents');
  });
});
