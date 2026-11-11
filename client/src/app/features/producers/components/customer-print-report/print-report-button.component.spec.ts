import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MsalService } from '@azure/msal-angular';
import { Customer } from '@models';
import { ToastService } from '@core/services/toast.service';
import { CustomerScreenSources, customerScreenSources } from '@testing/customer-screen-sources';
import { permissionStub, providePermissions } from '@testing/permission.stub';
import { PrintReportButtonComponent } from './print-report-button.component';

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 42, scoularId: 'SAMPFRM', name: 'Sample Farms', location: 'Pratt', stateProvince: 'KS',
    phone: '316-555-0100', email: 'sample@example.com', eSignEnabled: false,
    achEnabled: false, ...over,
  };
}

describe('PrintReportButtonComponent', () => {
  let fixture: ComponentFixture<PrintReportButtonComponent>;
  let sources: CustomerScreenSources;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
  const printButton = (): HTMLButtonElement => host().querySelector<HTMLButtonElement>('button[title="Print"]')!;
  const dialogButton = (label: string): HTMLButtonElement | undefined =>
    Array.from(host().querySelectorAll<HTMLButtonElement>('app-button button')).find(b => squash(b.textContent) === label);
  const report = (): HTMLElement | null => host().querySelector('app-customer-print-report');
  const titleInput = (): HTMLInputElement | undefined =>
    Array.from(host().querySelectorAll('input')).find(i => i.placeholder === 'e.g., Grain Originator');
  function click(el: Element | null | undefined): void {
    if (!el) throw new Error('nothing to click');
    (el as HTMLElement).click();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    sources = customerScreenSources();
    await TestBed.configureTestingModule({
      imports: [PrintReportButtonComponent],
      providers: [
        ...sources.providers,
        providePermissions(permissionStub()),
        { provide: ToastService, useValue: { success: vi.fn(), warning: vi.fn() } },
        { provide: MsalService, useValue: { instance: { getActiveAccount: () => ({ name: 'Caden Egr', username: 'cegr' }), getAllAccounts: () => [] } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PrintReportButtonComponent);
  });

  it('opens the Producer Summary Report for the producer on screen, and Cancel closes it', () => {
    sources.customer.set(makeCustomer({ name: 'Smith Farms' }));
    fixture.detectChanges();
    expect(squash(printButton().textContent)).toBe('Print');
    expect(squash(report()?.textContent)).toBe('');

    click(printButton());
    expect(squash(host().textContent)).toContain('Producer Summary Report');
    expect(squash(host().textContent)).toContain('Smith Farms');

    click(dialogButton('Cancel'));
    expect(squash(report()?.textContent)).toBe('');
  });

  // It stayed in place on the profile while closed, so a title typed for one report was still there for the next.
  it('keeps the originator details typed into the report between opens', () => {
    sources.customer.set(makeCustomer());
    fixture.detectChanges();
    click(printButton());
    const title = titleInput()!;
    title.value = 'Grain Merchandiser';
    title.dispatchEvent(new Event('input'));
    click(dialogButton('Cancel'));

    click(printButton());
    expect(titleInput()!.value).toBe('Grain Merchandiser');
  });

  it('opens nothing with no customer on screen', () => {
    fixture.detectChanges();
    click(printButton());
    expect(report()).toBeNull();
  });

  // The button sits in the header's row of buttons, spaced by the row's gap; the closed report must not add one.
  it('takes no space in the button row but the button itself', () => {
    sources.customer.set(makeCustomer());
    fixture.detectChanges();
    expect(host().classList).toContain('contents');
    expect(report()!.classList).toContain('contents');
  });
});
