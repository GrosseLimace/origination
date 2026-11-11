import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChangeDetectionStrategy, Component, Type, computed, inject, input, output, signal } from '@angular/core';
import { SelectedProducerActivity } from '@core/context/selected-producer-activity';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { SelectedProducerEngagement } from '@core/context/selected-producer-engagement';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { BehaviorSubject, Observable, Subject, of } from 'rxjs';

import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { ToastService } from '@core/services/toast.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { providePermissions } from '@testing/permission.stub';
import { ProducerProfilesFake, producerProfile, producerProfilesFake, provideProducerProfiles } from '@testing/producer-profiles.fake';
import { OutlookCalendarService } from '@core/services/outlook-calendar.service';
import { environment } from '@env/environment';
import { CustomerSlotComponent } from '@core/modules/customer-slot.component';
import { ModuleManifest } from '@core/modules/module-manifest';
import { APP_MODULES } from '@core/modules/module-registry';
import type { Contract, Customer, Note, NoteLastContact, PlantingIntention, Reminder, ReminderDue, StoredGrain } from '@models';

import { HomeComponent } from './home.component';
import { TradeUnitContext } from '@core/context/trade-unit-context.service';
import { CustomerStore } from '../../data-access/customer.store';
import { CustomersApiService } from '../../data-access/customers-api.service';

/**
 * Rendering tests for the producer page: the REAL home template, with selector-compatible stubs for
 * its children that print what they are given. Each test changes state the way production does - an
 * API answer landing after the first render, a child output, a DOM event, an effect, a timer - and
 * then waits for the zoneless scheduler (fixture.whenStable) rather than forcing change detection,
 * so a value that changes without notifying Angular would stay stale on screen and fail the test.
 * This is what makes it safe to put the page on OnPush.
 */

// ── Child stubs (OnPush, like every real child) ─────────────────────────────

const ids = (rows: { id: number | string }[] | null | undefined) => (rows ?? []).map(r => r.id).join(',');

@Component({
  selector: 'app-customer-list', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="list">roster:{{ ids(customers()) }}|selected:{{ selectedCustomer()?.id }}|loading:{{ loading() }}|lastContacts:{{ noteLastContacts().length }}|myReminders:{{ myReminders().length }}|linked:{{ ids(linkedProducerCustomers()) }}</div>`,
})
class StubList {
  readonly ids = ids;
  readonly customers = input<Customer[]>([]);
  readonly selectedCustomer = input<Customer | null>(null);
  readonly noteLastContacts = input<NoteLastContact[]>([]);
  readonly myReminders = input<ReminderDue[]>([]);
  readonly loading = input(false);
  readonly producerDetailsMap = input<unknown>();
  readonly linkedProducerCustomers = input<Customer[]>([]);
  readonly selectCustomer = output<Customer>();
  readonly prefetchCustomer = output<Customer>();
  readonly clearSelection = output<void>();
}

@Component({
  selector: 'app-customer-profile', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="profile">name:{{ customer().name }}|contracts:{{ ids(contracts()) }}|tickets:{{ ids(tickets()) }}|planting:{{ ids(plantingIntentions()) }}|grain:{{ ids(storedGrain()) }}|loadingContracts:{{ isLoadingContracts() }}|contractsError:{{ contractsLoadError() }}|linked:{{ ids(linkedCustomers()) }}|openContract:{{ openContractId() }}|estimates:{{ yieldEstimates().length }}</div>`,
})
class StubProfile {
  readonly ids = ids;
  readonly customer = input.required<Customer>();
  readonly selectedTradeUnits = input<unknown>();
  readonly contracts = input<Contract[]>([]);
  readonly tickets = input<{ id: number }[]>([]);
  readonly plantingIntentions = input<PlantingIntention[]>([]);
  readonly storedGrain = input<StoredGrain[]>([]);
  readonly dpContracts = input<unknown>();
  readonly yieldEstimates = input<unknown[]>([]);
  readonly isLoadingEstimates = input<unknown>();
  // Read from the page's SelectedProducerActivity, as the real profile and its tables do.
  readonly activity = inject(SelectedProducerActivity);
  readonly isLoadingContracts = this.activity.isLoadingContracts;
  readonly contractsLoadError = this.activity.contractsLoadError;
  readonly isLoadingPlanting = input<unknown>();
  readonly isLoadingStoredGrain = input<unknown>();
  readonly isLoadingDpContracts = input<unknown>();
  readonly allCustomerTickets = input<unknown>();
  readonly allCustomerPlantingIntentions = input<unknown>();
  readonly allCustomerStoredGrain = input<unknown>();
  readonly allCustomerDpContracts = input<unknown>();
  readonly linkedCustomers = input<Customer[]>([]);
  // The deep-linked contract reaches the screen's pieces through SelectedCustomerContext, as the contracts tab reads it.
  private readonly screen = inject(SelectedCustomerContext);
  readonly openContractId = computed(() => this.screen.link().contractId ?? null);
  readonly openTab = input<unknown>();
  readonly openTicketCrop = input<unknown>();
  readonly openPlantingYear = input<unknown>();
  readonly onAddPlanting = output<unknown>();
  readonly onEditPlanting = output<unknown>();
  readonly onDeletePlanting = output<number>();
  readonly onSelectLinkedCustomer = output<number>();
  readonly onContractsWideChange = output<boolean>();
}

@Component({
  selector: 'app-customer-notes', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="notes">notes:{{ ids(notes()) }}|loading:{{ isLoadingNotes() }}|saving:{{ isSavingNote() }}|saved:{{ noteSaveSucceededCounter() }}|linked:{{ ids(linkedCustomers()) }}</div>`,
})
class StubNotes {
  readonly ids = ids;
  // Read from the page, as the real card does: its notes and their state, and the linked producers.
  readonly engagement = inject(SelectedProducerEngagement);
  readonly notes = this.engagement.notes;
  readonly isLoadingNotes = this.engagement.isLoadingNotes;
  readonly isSavingNote = this.engagement.isSavingNote;
  readonly noteSaveSucceededCounter = this.engagement.noteSaveSucceededCounter;
  readonly linkedCustomers = inject(SelectedCustomerContext).linkedCustomers;
}

@Component({
  selector: 'app-customer-reminders', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="reminders">reminders:{{ ids(reminders()) }}|loading:{{ isLoading() }}</div>`,
})
class StubReminders {
  readonly ids = ids;
  // Read from the page, as the real card does.
  private readonly engagement = inject(SelectedProducerEngagement);
  readonly reminders = this.engagement.reminders;
  readonly isLoading = this.engagement.isLoadingReminders;
}

@Component({
  selector: 'app-calculator-panel', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (customer(); as producer) { <div data-testid="calculator">{{ producer.name }}</div> }`,
})
class StubCalculator {
  // Read from the page, as the real panel does.
  readonly customer = inject(SelectedCustomerContext).customer;
}

/** Engagement's sidebar panels and Calculators' floating launcher, as their manifests contribute them, with stubs
 *  for components. */
const sidebarModules: ModuleManifest[] = [{
  id: 'engagement',
  customerPanels: [
    { slot: 'sidebar', id: 'follow-ups', requires: [], order: 10, component: () => Promise.resolve(StubReminders) },
    { slot: 'sidebar', id: 'notes', requires: [], order: 20, component: () => Promise.resolve(StubNotes) },
  ],
}, {
  id: 'calculators',
  customerPanels: [
    { slot: 'floating', id: 'calculator-launcher', requires: [], order: 10, component: () => Promise.resolve(StubCalculator) },
  ],
}];

/** Stands in for the app shell, which is OnPush too: home rendered inside an OnPush parent must still
 *  refresh from its own signals, with nothing marking the parent. */
@Component({
  selector: 'app-onpush-shell', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HomeComponent], template: '<main><app-home /></main>',
})
class OnPushShell {}

// ── Fixtures ────────────────────────────────────────────────────────────────

const customer = (id: number, over: Partial<Customer> = {}) =>
  ({ id, scoularId: `S-${id}`, name: `Producer ${id}`, ...over }) as Customer;
const contract = (id: number, code: string) => ({ id, ctrmCustomerId: code, sourceContractId: `P${id}` }) as Contract;
const note = (id: number, customerId: number, createdAt: Date) =>
  ({ id, customerId, customerName: '', content: '', isPinned: false, createdBy: '', createdAt }) as Note;
const A = customer(1);
const B = customer(2);

/** Every API read the page makes, answering empty by default. Tests swap in a Subject for the read
 *  they want to land after the first render. */
function makeApi() {
  const empty = <T>() => vi.fn((..._args: unknown[]): Observable<T> => of([] as unknown as T));
  return {
    getCustomers: empty<Customer[]>(),
    getContracts: empty<Contract[]>(),
    getPlantingIntentions: empty<PlantingIntention[]>(),
    getStoredGrain: empty<StoredGrain[]>(),
    getDpContracts: empty<unknown[]>(),
    getAllProducerDetails: empty<unknown[]>(),
    getProducerDetails: vi.fn((id: number) => of({ id, customerId: id, customerName: '' })),
    saveProducerDetails: vi.fn((id: number) => of({ id, customerId: id, customerName: '' })),
    getDashboardPlantingEstimates: empty<unknown[]>(),
    getCommodities: empty<unknown[]>(),
    getNotes: empty<Note[]>(),
    getNotesLastContact: empty<NoteLastContact[]>(),
    getNotesByCustomer: empty<Note[]>(),
    getRemindersByCustomer: empty<Reminder[]>(),
    getCustomerBySourceId: vi.fn((): Observable<Customer | null> => of(null)),
    getCustomersLinkedTo: empty<Customer[]>(),
    getCustomerById: vi.fn((id: number) => of(customer(id))),
    getPlantingIntentionsByCustomer: empty<PlantingIntention[]>(),
    getPricingLinesByCustomer: empty<unknown[]>(),
    getContractsByCustomer: empty<Contract[]>(),
    getTicketsByCustomer: empty<unknown[]>(),
    getStoredGrainByCustomer: empty<StoredGrain[]>(),
    getDpContractsByCustomer: empty<unknown[]>(),
    createNote: vi.fn((customerId: number) => of(note(500, customerId, new Date()))),
  };
}
type ApiStub = ReturnType<typeof makeApi>;

function makeAppState() {
  const s = {
    selectedTradeUnits: signal<string[]>(['TU1']),
    selectedCustomer: signal<Customer | null>(null),
    customers: signal<Customer[]>([]),
    contracts: signal<Contract[]>([]),
    plantingIntentions: signal<PlantingIntention[]>([]),
    notes: signal<Note[]>([]),
    notesLoaded: signal(false),
    noteLastContacts: signal<NoteLastContact[]>([]),
    myReminders: signal<ReminderDue[]>([]),
    storedGrain: signal<StoredGrain[]>([]),
    dpContracts: signal<unknown[]>([]),
    dpContractsLoaded: signal(false),
    commodities: signal<unknown[]>([]),
    commodityConversions: signal<unknown[]>([]),
    pricingLines: signal<unknown[]>([]),
    selectCustomer: vi.fn((c: Customer | null) => s.selectedCustomer.set(c)),
    setCustomers: vi.fn((v: Customer[]) => s.customers.set(v)),
    setContracts: vi.fn(), setPlantingIntentions: vi.fn(), setNotes: vi.fn(), setNoteLastContacts: vi.fn(),
    setMyReminders: vi.fn(), setStoredGrain: vi.fn(), setDpContracts: vi.fn(),
    mergeCustomerDpContracts: vi.fn(), setPricingLines: vi.fn(),
    setCustomersLoadFailed: vi.fn(), setNoteLastContactsLoadFailed: vi.fn(),
    setPlantingIntentionsLoadFailed: vi.fn(),
  };
  return s;
}

describe('HomeComponent (rendered)', () => {
  let fixture: ComponentFixture<unknown>;
  let api: ApiStub;
  let app: ReturnType<typeof makeAppState>;
  /** Every producer's saved details, as the page and its pieces read them. */
  let profiles: ProducerProfilesFake;
  let queryParams: BehaviorSubject<Params>;
  const originalReadAhead = environment.ctrmReadAheadEnabled;

  const text = (testId: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`)?.textContent ?? null;
  const list = () => fixture.debugElement.query(By.directive(StubList)).componentInstance as StubList;
  const profile = () => fixture.debugElement.query(By.directive(StubProfile))?.componentInstance as StubProfile;
  const settle = () => fixture.whenStable();

  async function render(
    arrange?: (api: ApiStub, app: ReturnType<typeof makeAppState>) => void, root: Type<unknown> = HomeComponent,
  ): Promise<void> {
    api = makeApi();
    app = makeAppState();
    profiles = producerProfilesFake();
    arrange?.(api, app);
    TestBed.configureTestingModule({
      providers: [
        { provide: CustomersApiService, useExisting: ApiService },
        { provide: ApiService, useValue: api },
        { provide: CustomerStore, useExisting: AppStateService },
        { provide: AppStateService, useValue: app },
        { provide: TradeUnitContext, useValue: app },
        { provide: ToastService, useValue: { error: vi.fn(), success: vi.fn(), info: vi.fn() } },
        { provide: UsageTrackingService, useValue: { trackProfileOpened: vi.fn() } },
        providePermissions(),
        provideProducerProfiles(profiles),
        // The right column is the sidebar slot: Engagement's two cards, stubbed, contributed as the real module does.
        { provide: APP_MODULES, useValue: sidebarModules },
        { provide: OutlookCalendarService, useValue: { addToOutlook: vi.fn(() => of(null)) } },
        { provide: MsalService, useValue: { instance: { getActiveAccount: () => null, getAllAccounts: () => [] } } },
        { provide: ActivatedRoute, useValue: { queryParams } },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(HomeComponent, {
      set: {
        imports: [StubList, StubProfile, CustomerSlotComponent],
      },
    });
    fixture = TestBed.createComponent(root);
    await settle();
  }

  beforeEach(() => {
    queryParams = new BehaviorSubject<Params>({});
    environment.ctrmReadAheadEnabled = false;
  });

  afterEach(() => {
    environment.ctrmReadAheadEnabled = originalReadAhead;
    vi.restoreAllMocks();
  });

  it('shows the roster when it lands after the first render, and drops the loading state', async () => {
    const roster = new Subject<Customer[]>();
    await render(a => a.getCustomers.mockReturnValue(roster));
    expect(text('list')).toContain('loading:true');

    roster.next([A, B]);
    await settle();

    expect(text('list')).toContain('roster:1,2');
    expect(text('list')).toContain('loading:false');
  });

  it('opens a producer picked in the list, then fills in contracts and notes as each read lands', async () => {
    const contracts = new Subject<Contract[]>();
    const notes = new Subject<Note[]>();
    await render(a => {
      a.getCustomers.mockReturnValue(of([A, B]));
      a.getContractsByCustomer.mockReturnValue(contracts);
      a.getNotesByCustomer.mockReturnValue(notes);
    });
    expect(text('profile')).toBeNull();

    list().selectCustomer.emit(A);
    await settle();
    expect(text('profile')).toContain('name:Producer 1');
    expect(text('profile')).toContain('loadingContracts:true');
    expect(text('calculator')).toBe('Producer 1');
    expect(text('list')).toContain('selected:1');

    contracts.next([contract(10, 'S-1')]);
    await settle();
    expect(text('profile')).toContain('contracts:10');
    expect(text('profile')).toContain('loadingContracts:false');

    notes.next([note(5, 1, new Date())]);
    notes.complete();
    await settle();
    expect(text('notes')).toContain('notes:5');
    expect(text('notes')).toContain('loading:false');
  });

  it('shows a failed contract read as an error, and a successful retry replaces it', async () => {
    const first = new Subject<Contract[]>();
    await render(a => {
      a.getCustomers.mockReturnValue(of([A]));
      a.getContractsByCustomer.mockReturnValue(first);
    });
    list().selectCustomer.emit(A);
    await settle();

    first.error({ status: 503 });
    await settle();
    expect(text('profile')).toContain('contractsError:The data source is temporarily unavailable. Please retry shortly.');
    expect(text('profile')).toContain('loadingContracts:false');

    const retry = new Subject<Contract[]>();
    api.getContractsByCustomer.mockReturnValue(retry);
    // The contracts table's Retry button calls the page's activity directly.
    profile().activity.retryContracts();
    await settle();
    expect(text('profile')).toContain('loadingContracts:true');
    retry.next([contract(11, 'S-1')]);
    await settle();
    expect(text('profile')).toContain('contracts:11');
    expect(text('profile')).toMatch(/contractsError:\|/);
  });

  it('shows the producer\'s follow-ups when they land', async () => {
    const reminders = new Subject<Reminder[]>();
    await render(a => {
      a.getCustomers.mockReturnValue(of([A]));
      a.getRemindersByCustomer.mockReturnValue(reminders);
    });
    list().selectCustomer.emit(A);
    await settle();
    expect(text('reminders')).toContain('loading:true');

    reminders.next([{ id: 9, customerId: 1, customerName: '', dueAt: '2026-10-20T00:00:00Z', subject: '', isCompleted: false, createdAt: '' }]);
    await settle();
    expect(text('reminders')).toContain('reminders:9|loading:false');
  });

  it('adds a linked producer from another trade unit to the dropdowns when the walk lands', async () => {
    const linkedTo = new Subject<Customer[]>();
    await render(a => {
      a.getCustomers.mockReturnValue(of([A]));
      a.getCustomersLinkedTo.mockReturnValue(linkedTo);
    });
    list().selectCustomer.emit(A);
    await settle();
    expect(text('profile')).toContain('linked:|');

    // Producer 90's saved details link to A.
    profiles.put(producerProfile(90, { linkedProducerIds: 'S-1' }));
    linkedTo.next([customer(90)]);
    linkedTo.complete();
    await settle();
    expect(text('profile')).toContain('linked:90');
    expect(text('notes')).toContain('linked:90');
    expect(text('list')).toContain('linked:90');
  });

  it('a planting read that lands later shows on the profile', async () => {
    const planting = new Subject<PlantingIntention[]>();
    await render(a => {
      a.getCustomers.mockReturnValue(of([A]));
      a.getPlantingIntentionsByCustomer.mockReturnValue(planting);
    });
    list().selectCustomer.emit(A);
    await settle();

    planting.next([{ id: 30 } as PlantingIntention]);
    await settle();
    expect(text('profile')).toContain('planting:30');
  });

  it('a note added from the notes card reaches the panel and resets the form counter', async () => {
    await render(a => a.getCustomers.mockReturnValue(of([A])));
    list().selectCustomer.emit(A);
    await settle();

    const notesCard = fixture.debugElement.query(By.directive(StubNotes)).componentInstance as StubNotes;
    // The real card's Add Note calls the page's engagement directly.
    notesCard.engagement.addNote({ content: 'hi', mentions: [] });
    await settle();
    expect(text('notes')).toContain('notes:500');
    expect(text('notes')).toContain('saved:1');
  });

  it('follows a trade-unit change made elsewhere: the producer closes and the new roster shows', async () => {
    await render(a => a.getCustomers.mockReturnValue(of([A, B])));
    list().selectCustomer.emit(A);
    await settle();
    expect(text('profile')).not.toBeNull();

    api.getCustomers.mockReturnValue(of([customer(50)]));
    app.selectedTradeUnits.set(['TU2']);
    await settle();
    expect(text('profile')).toBeNull();
    expect(text('list')).toContain('roster:50');
  });

  it('shows a last-contact aggregate the shared state receives later (effect path)', async () => {
    await render();
    app.noteLastContacts.set([{ customerId: 1, lastNoteAt: new Date() }]);
    await settle();
    expect(text('list')).toContain('lastContacts:1');
  });

  it('opens a deep-linked producer once the roster arrives (polling timer path)', async () => {
    const roster = new Subject<Customer[]>();
    queryParams.next({ customerId: '2', contractId: '55' });
    await render(a => a.getCustomers.mockReturnValue(roster));
    expect(text('profile')).toBeNull();

    roster.next([A, B]);
    await new Promise(resolve => setTimeout(resolve, 150));
    await settle();
    expect(text('profile')).toContain('name:Producer 2');
    expect(text('profile')).toContain('openContract:55');
  });

  it('opens a producer from a query-string change while the page is showing', async () => {
    await render(a => a.getCustomers.mockReturnValue(of([A, B])));
    queryParams.next({ customerId: '1' });
    await settle();
    expect(text('profile')).toContain('name:Producer 1');
  });

  it('the Back button and the list\'s clear both close the producer', async () => {
    await render(a => a.getCustomers.mockReturnValue(of([A, B])));
    list().selectCustomer.emit(A);
    await settle();

    ((fixture.nativeElement as HTMLElement).querySelector('button') as HTMLButtonElement).click();
    await settle();
    expect(text('profile')).toBeNull();

    list().selectCustomer.emit(B);
    await settle();
    list().clearSelection.emit();
    await settle();
    expect(text('profile')).toBeNull();
  });

  it('hides the list on a narrow window once a producer is open, following window resizes', async () => {
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
    await render(a => a.getCustomers.mockReturnValue(of([A])));
    list().selectCustomer.emit(A);
    await settle();
    const listColumn = () => (fixture.nativeElement as HTMLElement).querySelector('app-customer-list')!.parentElement!;
    expect(listColumn().classList.contains('hidden')).toBe(false);

    width.mockReturnValue(600);
    window.dispatchEvent(new Event('resize'));
    await settle();
    expect(listColumn().classList.contains('hidden')).toBe(true);
  });

  it('widens the contracts table when the profile asks (child output path)', async () => {
    await render(a => a.getCustomers.mockReturnValue(of([A])));
    list().selectCustomer.emit(A);
    await settle();
    const grid = () => (fixture.nativeElement as HTMLElement).querySelector('.space-y-6')!;
    expect(grid().className).toContain('xl:grid');

    profile().onContractsWideChange.emit(true);
    await settle();
    expect(grid().className).not.toContain('xl:grid');
  });

  it('inside an OnPush shell, a producer opened from the list fills in as its reads land', async () => {
    const contracts = new Subject<Contract[]>();
    await render(a => {
      a.getCustomers.mockReturnValue(of([A, B]));
      a.getContractsByCustomer.mockReturnValue(contracts);
    }, OnPushShell);
    expect(text('list')).toContain('roster:1,2');

    list().selectCustomer.emit(B);
    await settle();
    expect(text('profile')).toContain('name:Producer 2');

    contracts.next([contract(20, 'S-2')]);
    await settle();
    expect(text('profile')).toContain('contracts:20');

    api.getCustomers.mockReturnValue(of([customer(50)]));
    app.selectedTradeUnits.set(['TU2']);
    await settle();
    expect(text('profile')).toBeNull();
    expect(text('list')).toContain('roster:50');
  });
});
