import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MsalService } from '@azure/msal-angular';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { APP_MODULES } from '@core/modules/module-registry';
import { ApiService } from '@core/services/api.service';
import { NlqFilterContext, NlqFilterService } from './features/lists/nlq/nlq-filter.service';
import { UserTradeUnitsService } from '@core/services/user-trade-units.service';
import { Customer, ProducerDetails } from '@models';
import { permissionStub, providePermissions } from '@testing/permission.stub';
import { ProducerProfilesFake, producerProfilesFake, provideProducerProfiles } from '@testing/producer-profiles.fake';
import { CustomerListComponent } from './features/customers/components/customer-list/customer-list.component';
import { CustomerStore } from './features/customers/data-access/customer.store';
import { CustomersApiService } from './features/customers/data-access/customers-api.service';
import { SavedListsApiService } from './features/lists/data-access/saved-lists-api.service';
import { SavedListFilterStore } from './features/lists/data-access/saved-list-filter.store';
import { SavedListsStore } from './features/lists/data-access/saved-lists.store';
import { listsModule } from './features/lists/lists.module';
import { SavedList } from './features/lists/models/saved-list.model';

/**
 * The customer list with the Lists module's saved-list picker in its list-filter slot, as the composition root puts
 * them together: the picker offers the user's lists for the selection, and picking one narrows the list to who it
 * holds. Customers and Lists don't know each other, so only a spec here sees both. The engine is real except
 * parseAndFilter, a "Kansas producers" rule, so the tests don't depend on the grammar.
 */
describe('the customer list with Lists\' saved-list picker', () => {
  let fixture: ComponentFixture<CustomerListComponent>;
  let profiles: ProducerProfilesFake;
  let nlq: NlqFilterService;
  let savedLists: SavedList[];

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const rowNames = (): string[] => Array.from(host().querySelectorAll<HTMLElement>('[id^="customer-item-"]'))
    .map(r => (r.querySelector('p')?.textContent ?? '').trim());
  const listSelect = (): HTMLSelectElement | null => host().querySelector<HTMLSelectElement>('select[aria-label="Saved list"]');
  const optionNames = (): string[] => Array.from(listSelect()?.options ?? []).map(o => o.textContent?.trim() ?? '');

  const makeCustomer = (id: number, name: string, stateProvince: string): Customer =>
    ({ id, scoularId: `S${id}`, name, location: 'Pratt', stateProvince, phone: '', email: '', eSignEnabled: false, achEnabled: false });
  const roster = (): Customer[] => [makeCustomer(1, 'Alpha Ag', 'KS'), makeCustomer(2, 'Bravo Bros', 'NE'), makeCustomer(3, 'Charlie Co', 'KS')];
  const makeList = (over: Partial<SavedList> = {}): SavedList =>
    ({ id: 10, name: 'Kansas growers', query: 'kansas growers', tradeUnits: '2190', createdAt: '2026-09-01T00:00:00', ...over });

  async function create(inputs: { loading?: boolean } = {}): Promise<void> {
    TestBed.inject(CustomerStore).setCustomers(roster());
    fixture = TestBed.createComponent(CustomerListComponent);
    fixture.componentRef.setInput('customers', roster());
    fixture.componentRef.setInput('loading', inputs.loading ?? false);
    fixture.detectChanges();
    // The picker's code loads the first time the slot shows it.
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function pick(id: string): Promise<void> {
    const select = listSelect();
    if (!select) throw new Error('saved-list picker not rendered');
    select.value = id;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.clear();
    profiles = producerProfilesFake();
    savedLists = [];
    nlq = new NlqFilterService();
    vi.spyOn(nlq, 'parseAndFilter').mockImplementation((_query: string, ctx: NlqFilterContext) => ({
      customers: ctx.customers.filter(c => c.stateProvince === 'KS'),
      detectedState: null,
      matchedPatterns: ['state'],
    }));
    await TestBed.configureTestingModule({
      imports: [CustomerListComponent],
      providers: [
        { provide: APP_MODULES, useValue: [listsModule] },
        { provide: SavedListsApiService, useValue: { getSavedLists: () => of(savedLists), getQueryLibrary: () => of([]) } },
        { provide: CustomersApiService, useValue: { searchCustomers: () => of([]), searchOdsCustomers: () => of([]) } },
        { provide: ApiService, useValue: {} },
        { provide: NlqFilterService, useValue: nlq },
        providePermissions(permissionStub(['saved-lists:read:own'])),
        provideProducerProfiles(profiles),
        SelectedCustomerContext,
        { provide: MsalService, useValue: { instance: { getActiveAccount: () => null, getAllAccounts: () => [] } } },
        { provide: UserTradeUnitsService, useValue: { load: () => of([]), openPreferences: () => undefined, computeAvailableTradeUnits: () => [] } },
      ],
    }).compileComponents();
    TestBed.inject(TradeUnitContext).setUserGroups([{ groupName: 'Kansas', tradeUnitCodes: ['2191', '2190'] }]);
    TestBed.inject(TradeUnitContext).setTradeUnits(['2190']);
  });

  it("offers the lists sharing a trade unit once the producers load, narrows to the list's result with its count, and back to all", async () => {
    savedLists = [makeList({ id: 10, tradeUnits: '2190,2191' }), makeList({ id: 11, name: 'Elsewhere', tradeUnits: '9999' })];
    await create({ loading: true });
    expect(listSelect()?.closest('.hidden')).not.toBeNull();   // hidden while the producers load

    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();
    expect(listSelect()?.closest('.hidden')).toBeNull();
    expect(optionNames()).toEqual(['All Producers', 'Kansas growers']);
    expect(rowNames()).toEqual(['Alpha Ag', 'Bravo Bros', 'Charlie Co']);

    await pick('10');
    expect(rowNames()).toEqual(['Alpha Ag', 'Charlie Co']);
    expect(optionNames()[1]).toBe('Kansas growers (2)');
    expect(host().textContent).not.toContain('Running saved list...');

    await pick('all');
    expect(rowNames()).toEqual(['Alpha Ag', 'Bravo Bros', 'Charlie Co']);
  });

  it('applies a list\'s includes and excludes, says "No producers found" for an empty one, and goes back to all when the list is gone', async () => {
    savedLists = [
      makeList({ id: 10, includedCustomerIds: [2], excludedCustomerIds: [3] }),
      makeList({ id: 12, name: 'Nobody', excludedCustomerIds: [1, 3] }),
    ];
    await create();

    await pick('10');
    expect(rowNames()).toEqual(['Alpha Ag', 'Bravo Bros']);

    await pick('12');
    expect(rowNames()).toEqual([]);
    expect(host().textContent).toContain('No producers found');

    TestBed.inject(SavedListsStore).setLists([makeList({ id: 20, name: 'Another' })]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(TestBed.inject(SavedListFilterStore).selectedId()).toBe('all');
    expect(rowNames()).toEqual(['Alpha Ag', 'Bravo Bros', 'Charlie Co']);
  });

  // A list's prompts on acres, contacts, links, grain on farm and bin sites read every producer's saved details.
  it("runs the list with every producer's saved details", async () => {
    profiles.set([{ customerId: 1, totalAcres: 900 } as ProducerDetails]);
    savedLists = [makeList()];
    await create();

    await pick('10');

    const [, ctx] = vi.mocked(nlq.parseAndFilter).mock.calls.at(-1)!;
    expect(ctx.producerProfiles).toBe(profiles.profiles());
  });
});
