import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { Commodity, Customer, ProducerDetails } from '@models';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { ProducerEdit } from '@core/context/producer-editing';
import { CustomersApiService } from '@features/customers';
import { CustomerScreenSources, customerScreenSources } from '@testing/customer-screen-sources';
import { ProducerEditingFake, producerEditingFake, provideProducerEditing } from '@testing/producer-editing.fake';
import { permissionStub, providePermissions } from '@testing/permission.stub';
import { EditCustomerDialogComponent } from './edit-customer-dialog.component';
import { EditProducerButtonComponent } from './edit-producer-button.component';

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 42, scoularId: 'SAMPFRM', name: 'Sample Farms', farm: '', location: '', phone: '', email: '', totalAcres: 0,
    linkedProducerIds: [], eSignEnabled: false, achEnabled: false, ...over,
  };
}

const anEdit = (): ProducerEdit => ({
  customerId: 42, acres: 120, commodities: [], primaryContact: '', primaryPhone: '', contacts: [], binSites: [],
  linkedProducerIds: [], removedIncomingIds: [], eSignEnabled: false, tradeUnitCodes: [], reconcileTradeUnits: false,
  grainOnFarm: [], intentionMoves: [],
});

describe('EditProducerButtonComponent', () => {
  let fixture: ComponentFixture<EditProducerButtonComponent>;
  let sources: CustomerScreenSources;
  let editing: ProducerEditingFake;
  let tracking: { trackProducerDetailsEdit: ReturnType<typeof vi.fn> };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
  const editButton = (): HTMLButtonElement =>
    Array.from(host().querySelectorAll<HTMLButtonElement>(':scope > button')).find(b => squash(b.textContent) === 'Edit')!;
  const dialogElement = (): HTMLElement | null => host().querySelector('app-edit-customer-dialog');
  const dialog = (): EditCustomerDialogComponent => fixture.debugElement.query(By.directive(EditCustomerDialogComponent)).componentInstance;
  async function click(el: Element | null | undefined): Promise<void> {
    if (!el) throw new Error('nothing to click');
    (el as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    sources = customerScreenSources();
    editing = producerEditingFake();
    // A trade unit selected, so the dialog searches the page's producers rather than reading every one.
    editing.producersTradeUnits.set(['2190']);
    tracking = { trackProducerDetailsEdit: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [EditProducerButtonComponent],
      providers: [
        ...sources.providers,
        provideProducerEditing(editing),
        providePermissions(permissionStub(['producer-details:read', 'producer-details:write'])),
        { provide: CustomersApiService, useExisting: ApiService },
        {
          provide: ApiService,
          useValue: {
            getAllTradeUnits: () => of([]),
            getCommodities: () => of([]),
            getPlantingCommodities: () => of([]),
            getCustomerTradeUnits: () => of([]),
            getProducerDetails: () => of({ customerId: 42 } as ProducerDetails),
            getCustomers: () => of([makeCustomer({ id: 7, name: 'Other Farm' })]),
          },
        },
        { provide: ToastService, useValue: { error: () => {}, success: () => {} } },
        {
          provide: AppStateService,
          useValue: {
            inScopeGroupNames: signal<readonly string[]>([]),
            inScopeTradeUnitCodes: signal<readonly string[]>([]),
            commodities: signal<Commodity[]>([]),
          },
        },
        { provide: UsageTrackingService, useValue: tracking },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(EditProducerButtonComponent);
  });

  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('opens Edit Producer Details for the producer on screen, and Cancel closes it', async () => {
    sources.customer.set(makeCustomer({ name: 'Smith Farms' }));
    fixture.detectChanges();
    expect(squash(dialogElement()?.textContent)).toBe('');

    await click(editButton());
    expect(squash(host().textContent)).toContain('Edit Producer Details');
    expect(squash(host().textContent)).toContain('Smith Farms');

    await click(Array.from(host().querySelectorAll('button')).find(b => squash(b.textContent) === 'Cancel'));
    expect(squash(dialogElement()?.textContent)).toBe('');
  });

  it('hands a saved edit to the page, counts it as a producer details edit, and closes', async () => {
    sources.customer.set(makeCustomer());
    fixture.detectChanges();
    await click(editButton());

    const edit = anEdit();
    dialog().save.emit(edit);
    fixture.detectChanges();

    expect(editing.save).toHaveBeenCalledWith(edit);
    expect(tracking.trackProducerDetailsEdit).toHaveBeenCalledWith('42');
    expect(squash(dialogElement()?.textContent)).toBe('');
  });

  it('opens nothing with no customer on screen', async () => {
    fixture.detectChanges();
    await click(editButton());
    expect(dialogElement()).toBeNull();
  });

  // The button sits in the header's row of buttons, spaced by the row's gap; the closed dialog must not add one.
  it('takes no space in the button row but the button itself', () => {
    sources.customer.set(makeCustomer());
    fixture.detectChanges();
    expect(host().classList).toContain('contents');
    expect(dialogElement()!.classList).toContain('contents');
  });
});
