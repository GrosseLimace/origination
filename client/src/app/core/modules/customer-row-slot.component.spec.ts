import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChangeDetectionStrategy, Component, ErrorHandler, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Customer } from '@models';
import { PermissionStub, permissionStub, providePermissions } from '@testing/permission.stub';
import { APP_MODULES } from './module-registry';
import { CustomerPanel, ModuleManifest } from './module-manifest';
import { CustomerRowSlotComponent } from './customer-row-slot.component';

@Component({ selector: 'app-stub-tag', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: '[tag {{ customer().id }}]' })
class StubTag { readonly customer = input.required<Customer>(); }

@Component({ selector: 'app-stub-detail', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: '[detail {{ customer().name }}]' })
class StubDetail { readonly customer = input.required<Customer>(); }

@Component({ selector: 'app-stub-trader', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: '[trader]' })
class StubTrader { readonly customer = input.required<Customer>(); }

const loads = { tag: 0 };
const tag: CustomerPanel = {
  slot: 'row-tags', id: 'tag', requires: ['producer-details:read'], segments: ['Producer'], order: 10,
  component: () => { loads.tag++; return Promise.resolve(StubTag); },
};
const second: CustomerPanel = { slot: 'row-details', id: 'second', requires: [], order: 20, component: () => Promise.resolve(StubDetail) };
const first: CustomerPanel = { slot: 'row-details', id: 'first', requires: [], order: 10, component: () => Promise.resolve(StubTag) };
const traderOnly: CustomerPanel = { slot: 'row-tags', id: 'trader', requires: [], segments: ['Commercial'], order: 20, component: () => Promise.resolve(StubTrader) };
const broken: CustomerPanel = { slot: 'row-details', id: 'broken', requires: [], order: 30, component: () => Promise.reject(new Error('chunk gone')) };

/** Hosts a customer list row's slot: the modules' panels for it, each given the row's customer. */
describe('CustomerRowSlotComponent', () => {
  let access: PermissionStub;
  let errors: { handleError: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    loads.tag = 0;
    access = permissionStub(['producer-details:read']);
    errors = { handleError: vi.fn() };
    const modules: ModuleManifest[] = [{ id: 'producers', customerPanels: [second, tag, traderOnly, broken, first] }];
    TestBed.configureTestingModule({
      providers: [{ provide: APP_MODULES, useValue: modules }, providePermissions(access), { provide: ErrorHandler, useValue: errors }],
    });
  });

  async function render(slot: 'row-tags' | 'row-details', customer: Customer): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(CustomerRowSlotComponent);
    fixture.componentRef.setInput('slot', slot);
    fixture.componentRef.setInput('customer', customer);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

  it("renders the slot's panels in order, each given the row's customer, leaving out one whose code failed to load", async () => {
    const el = await render('row-details', { id: 7, name: 'Seven' } as Customer);

    expect(text(el)).toBe('[tag 7][detail Seven]');
    expect(errors.handleError).toHaveBeenCalledTimes(1);
  });

  it("keeps only the panels the user may see and that apply to the row's customer", async () => {
    expect(text(await render('row-tags', { id: 1, name: 'One' } as Customer))).toBe('[tag 1]');

    access.grant();
    expect(text(await render('row-tags', { id: 1, name: 'One' } as Customer))).toBe('');
  });

  it('loads a panel’s code once, however many rows show it', async () => {
    await render('row-tags', { id: 1, name: 'One' } as Customer);
    await render('row-tags', { id: 2, name: 'Two' } as Customer);

    expect(loads.tag).toBe(1);
  });
});
