import { describe, it, expect, vi } from 'vitest';
import { Component, ErrorHandler, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { render, screen } from '@testing-library/angular';
import { CustomerContribution } from './module-manifest';
import { CustomerContributionComponent } from './customer-contribution.component';

@Component({ selector: 'test-contracts', template: 'Contracts tab' })
class ContractsTab {}

@Component({ selector: 'test-tickets', template: 'Tickets tab' })
class TicketsTab {}

const contribution = (id: string, type: unknown, load = () => Promise.resolve(type as never)): CustomerContribution =>
  ({ id, requires: [], order: 10, component: load });

/** Stands in for a tab host: shows whichever contribution is current. */
@Component({
  imports: [CustomerContributionComponent],
  template: `<div data-testid="tab"><app-customer-contribution [contribution]="current()" /></div>`,
})
class Host {
  readonly current = signal<CustomerContribution>(contribution('none', ContractsTab));
}

describe('CustomerContributionComponent', () => {
  const handleError = vi.fn();

  async function show(start: CustomerContribution) {
    const view = await render(Host, { providers: [{ provide: ErrorHandler, useValue: { handleError } }] });
    view.fixture.componentInstance.current.set(start);
    view.fixture.detectChanges();
    return view;
  }

  it("renders a contribution once its code has loaded, loading it once", async () => {
    const load = vi.fn(() => Promise.resolve(ContractsTab as never));
    await show(contribution('contracts', ContractsTab, load));

    await screen.findByText('Contracts tab');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('renders one already loaded at once, without waiting on its code again', async () => {
    const loaded = contribution('contracts', ContractsTab);
    const first = await show(loaded);
    await screen.findByText('Contracts tab');
    first.fixture.destroy();
    TestBed.resetTestingModule();

    const load = vi.spyOn(loaded, 'component');
    await show(loaded);

    // No await: the second host renders from the session's cache in the same pass.
    expect(screen.getByTestId('tab').textContent).toContain('Contracts tab');
    expect(load).not.toHaveBeenCalled();
  });

  it('switches to another contribution when the host does', async () => {
    const view = await show(contribution('contracts', ContractsTab));
    await screen.findByText('Contracts tab');

    view.fixture.componentInstance.current.set(contribution('tickets', TicketsTab));
    view.fixture.detectChanges();

    await screen.findByText('Tickets tab');
    expect(screen.queryByText('Contracts tab')).toBeNull();
  });

  it('reports a contribution whose code fails to load, and renders nothing for it', async () => {
    handleError.mockClear();
    const failure = new Error('Failed to fetch dynamically imported module');
    const view = await show(contribution('broken', null, () => Promise.reject(failure)));

    await vi.waitFor(() => expect(handleError).toHaveBeenCalledWith(failure));
    view.fixture.detectChanges();
    expect(screen.getByTestId('tab').textContent?.trim()).toBe('');
  });
});
