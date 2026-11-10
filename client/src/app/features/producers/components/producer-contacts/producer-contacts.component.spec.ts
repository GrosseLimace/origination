import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChangeDetectorRef, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Customer, ProducerContactItem } from '@models';
import { CUSTOMER_SCREEN_SOURCE, CustomerScreenLink, SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { ProducerContactsComponent } from './producer-contacts.component';

const producer = (over: Partial<Customer> = {}) => ({ id: 1, name: 'Smith Farms', ...over }) as Customer;

/** A copy of `items` that counts how many times it is iterated: the sort copies it with a spread. */
function countingIterations<T>(items: T[]): { list: T[]; count: () => number } {
  let n = 0;
  const list = [...items];
  Object.defineProperty(list, Symbol.iterator, {
    value: function (this: T[]) { n++; return Array.prototype[Symbol.iterator].call(this); },
  });
  return { list, count: () => n };
}

describe('ProducerContactsComponent', () => {
  const customer = signal<Customer | null>(null);
  let fixture: ComponentFixture<ProducerContactsComponent>;
  let tracking: { trackCallClick: ReturnType<typeof vi.fn>; trackEmailClick: ReturnType<typeof vi.fn> };

  const host = () => fixture.nativeElement as HTMLElement;
  /** One entry per row: its name, and whether it carries the primary star. */
  const rows = () => Array.from(host().querySelectorAll(':scope > div')).map(row => ({
    name: (row.querySelector('span')?.textContent ?? '').trim(),
    primary: row.querySelector('svg[aria-label="Primary contact"]') !== null,
  }));
  /** A change-detection pass that re-checks this OnPush view without changing anything. */
  const rerender = () => {
    fixture.debugElement.injector.get(ChangeDetectorRef).markForCheck();
    fixture.detectChanges();
  };

  function show(who: Customer | null): void {
    customer.set(who);
    fixture.detectChanges();
  }

  beforeEach(() => {
    tracking = { trackCallClick: vi.fn(), trackEmailClick: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: CUSTOMER_SCREEN_SOURCE, useValue: { customer, linkedCustomers: signal([]), link: signal<CustomerScreenLink>({}) } },
        SelectedCustomerContext,
        { provide: UsageTrackingService, useValue: tracking },
      ],
    });
    fixture = TestBed.createComponent(ProducerContactsComponent);
  });

  it('lists contacts primary first, then in saved order', () => {
    show(producer({
      contacts: [
        { name: 'Cara', sortOrder: 2 },
        { name: 'Abe', sortOrder: 1 },
        { name: 'Pat', sortOrder: 3, isPrimary: true },
        { name: 'Dee' },                                   // no sortOrder sorts as 0
      ],
    }));

    expect(rows()).toEqual([
      { name: 'Pat', primary: true },
      { name: 'Dee', primary: false },
      { name: 'Abe', primary: false },
      { name: 'Cara', primary: false },
    ]);
  });

  it('falls back to one starred row from the legacy primary fields, and to none', () => {
    show(producer({ primaryContact: 'Old Pat', primaryPhone: '(402) 555-0100' }));
    expect(rows()).toEqual([{ name: 'Old Pat', primary: true }]);

    show(producer({ primaryPhone: '(402) 555-0100' }));
    expect(rows()).toEqual([{ name: 'Primary Contact', primary: true }]);

    show(producer());
    expect(rows()).toEqual([]);

    show(null);
    expect(rows()).toEqual([]);
  });

  it('sorts the contacts once per producer, not on every change-detection pass', () => {
    const contacts = countingIterations<ProducerContactItem>([{ name: 'B', sortOrder: 2 }, { name: 'A', sortOrder: 1 }]);
    show(producer({ contacts: contacts.list }));

    rerender();
    rerender();
    rerender();

    expect(contacts.count()).toBe(1);
    expect(rows().map(r => r.name)).toEqual(['A', 'B']);
  });

  it('sorts again for the next producer', () => {
    show(producer({ contacts: [{ name: 'B', sortOrder: 2 }, { name: 'A', sortOrder: 1 }] }));
    expect(rows().map(r => r.name)).toEqual(['A', 'B']);

    show(producer({ id: 2, contacts: [{ name: 'Y', sortOrder: 1 }, { name: 'Z', sortOrder: 0, isPrimary: true }] }));
    expect(rows()).toEqual([{ name: 'Z', primary: true }, { name: 'Y', primary: false }]);
  });

  it('links each phone and email, and counts the clicks against the producer', () => {
    show(producer({ id: 42, contacts: [{ name: 'Pat', phone: '402-555-0100', email: 'pat@farm.com' }] }));
    const phone = host().querySelector<HTMLAnchorElement>('a[href="tel:402-555-0100"]')!;
    const email = host().querySelector<HTMLAnchorElement>('a[href="mailto:pat@farm.com"]')!;

    // Followed, the links would have the test DOM try to open them.
    host().addEventListener('click', event => event.preventDefault());
    phone.click();
    email.click();

    expect(tracking.trackCallClick).toHaveBeenCalledWith('42');
    expect(tracking.trackEmailClick).toHaveBeenCalledWith('42');
  });
});
