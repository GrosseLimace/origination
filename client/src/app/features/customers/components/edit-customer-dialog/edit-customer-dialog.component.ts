import { Component, input, output, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { switchMap } from 'rxjs/operators';
import { DialogComponent, DialogHeaderComponent, DialogTitleComponent, DialogDescriptionComponent, DialogContentComponent, DialogFooterComponent } from '@shared/components/dialog/dialog.component';
import { Customer, Contract, Ticket, Commodity } from '@models';
import { ApiService } from '@core/services/api.service';

@Component({
  selector: 'app-edit-customer-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogComponent,
    DialogHeaderComponent,
    DialogTitleComponent,
    DialogDescriptionComponent,
    DialogContentComponent,
    DialogFooterComponent
  ],
  templateUrl: './edit-customer-dialog.component.html'
})
export class EditCustomerDialogComponent {
  private readonly apiService = inject(ApiService);

  public isOpen = input(false);
  public customer = input<Customer | null>(null);
  public tickets = input<Ticket[]>([]);
  public contracts = input<Contract[]>([]);
  public allCustomers = input<Customer[]>([]);
  public linkedCustomers = input<Customer[]>([]);
  public selectedTradeUnits = input<string[]>([]);

  public close = output<void>();
  public save = output<{
    customerId: number;
    acres: number;
    binCapacity: number;
    commodities: string[];
    primaryContact: string;
    linkedProducerIds: string[];
    removedIncomingIds: string[];
    eSignEnabled: boolean;
  }>();

  editAcres: string = '';
  editBinCapacity: string = '';
  editCommodities = signal<string[]>([]);
  private _derivedCommoditySet = new Set<string>();
  editLinkedProducerIds = signal<string[]>([]);
  removedIncomingIds = signal<string[]>([]); // incoming links removed locally, saved on Save Changes
  editESignEnabled = signal(false);
  editPrimaryContact = signal('');
  newCommodity = signal('');

  // Commodity lookup
  allCommodities = signal<Commodity[]>([]);
  filteredCommodities = signal<Commodity[]>([]);
  showSuggestions = signal(false);

  // Producer search
  // _allProducersForSearch caches the full cross-trade-unit list (only loaded when no trade units selected)
  private _allProducersForSearch: Customer[] = [];
  newProducerSearch = signal('');
  filteredProducers = signal<Customer[]>([]);
  showProducerSuggestions = signal(false);

  // Original values to track changes
  private _originalAcres: number = 0;
  private _originalBinCapacity: number = 0;
  private _originalCommodities: string[] = [];
  private _originalLinkedProducerIds: string[] = [];
  private _originalESignEnabled = false;
  private _originalPrimaryContact = '';

  private _initialized = false;
  isLoadingCommodities = signal(false);
  isLoadingProducers = signal(false);

  constructor() {
    // Eagerly load commodity lookup so it's ready before the user opens the dialog
    this.isLoadingCommodities.set(true);
    this.apiService.getCommodities().subscribe({
      next: (commodities) => {
        this.allCommodities.set(commodities);
        this.isLoadingCommodities.set(false);
        if (this.newCommodity().trim()) {
          this.onCommoditySearch();
        }
      },
      error: () => { this.isLoadingCommodities.set(false); }
    });

    effect(() => {
      const tradeUnits = this.selectedTradeUnits();
      // Eagerly load all producers whenever selectedTradeUnits becomes empty so the cache is
      // ready before the user opens the link search. Cached — only fetches once per session.
      if (tradeUnits.length === 0 && this._allProducersForSearch.length === 0 && !this.isLoadingProducers()) {
        this._loadAllProducersForSearch();
      }
    });

    effect(() => {
      const isOpen = this.isOpen();
      const customer = this.customer();

      // When isOpen becomes true, initialize the form from the customer
      if (isOpen && customer && !this._initialized) {
        this.editAcres = String(customer.totalAcres || 0);
        this.editBinCapacity = String(customer.binCapacity || 0);
        const ticketCommodities = [...new Set(
          this.tickets().map(t => t.productCode || '').filter(Boolean)
        )];
        const contractCommodities = [...new Set(
          this.contracts().map(c => c.commodityCode || '').filter(Boolean)
        )];
        this._derivedCommoditySet = new Set([...ticketCommodities, ...contractCommodities]);
        const userCommodities = customer.commodities || [];
        this.editCommodities.set([...new Set([...ticketCommodities, ...contractCommodities, ...userCommodities])].sort());
        this.editLinkedProducerIds.set([...(customer.linkedProducerIds || [])]);
        this.removedIncomingIds.set([]);
        this.editESignEnabled.set(customer.eSignEnabled);
        this.editPrimaryContact.set(customer.primaryContact || '');

        // Store original values
        this._originalAcres = customer.totalAcres || 0;
        this._originalBinCapacity = customer.binCapacity || 0;
        this._originalCommodities = [...this.editCommodities()];
        this._originalLinkedProducerIds = [...(customer.linkedProducerIds || [])];
        this._originalESignEnabled = customer.eSignEnabled;
        this._originalPrimaryContact = customer.primaryContact || '';

        // If no trade units and the cache still isn't loaded (edge case: first open before effect
        // on selectedTradeUnits fired), kick off the load now.
        if (this.selectedTradeUnits().length === 0 && this._allProducersForSearch.length === 0 && !this.isLoadingProducers()) {
          this._loadAllProducersForSearch();
        }

        this._initialized = true;
      }

      // Reset initialized flag when dialog closes
      if (!isOpen) {
        this._initialized = false;
      }
    });
  }

  hasChanges(): boolean {
    if (!this.customer()) return false;

    const linkedProducerIdsChanged = this.editLinkedProducerIds().length !== this._originalLinkedProducerIds.length
      || this.editLinkedProducerIds().some(id => !this._originalLinkedProducerIds.includes(id));

    const commoditiesChanged = this.editCommodities().length !== this._originalCommodities.length
      || this.editCommodities().some(c => !this._originalCommodities.includes(c));

    return this._parseNumericInput(this.editAcres) !== this._originalAcres
      || this._parseNumericInput(this.editBinCapacity) !== this._originalBinCapacity
      || commoditiesChanged
      || this.editESignEnabled() !== this._originalESignEnabled
      || this.editPrimaryContact() !== this._originalPrimaryContact
      || linkedProducerIdsChanged
      || this.removedIncomingIds().length > 0;
  }

  addCommodity(): void {
    const commodity = this.newCommodity().trim();
    if (commodity && !this.editCommodities().includes(commodity)) {
      this.editCommodities.update(c => [...c, commodity]);
      this.newCommodity.set('');
    }
  }

  isTicketCommodity(commodity: string): boolean {
    return this._derivedCommoditySet.has(commodity);
  }

  removeCommodity(commodity: string): void {
    if (this.isTicketCommodity(commodity)) return;
    this.editCommodities.update(c => c.filter(x => x !== commodity));
  }

  private readonly _commodityAliases: Record<string, string[]> = {
    'milo': ['milo', 'sorghum', 'sor', 'sg'],
    'sorghum': ['milo', 'sorghum', 'sor', 'sg'],
    'beans': ['soybeans', 'soy', 'beans', 'sb'],
    'soy': ['soybeans', 'soy', 'beans', 'sb'],
  };

  onCommoditySearch(): void {
    const term = this.newCommodity().trim().toLowerCase();
    if (!term) {
      this.filteredCommodities.set([]);
      return;
    }
    const searchTerms = this._commodityAliases[term] ?? [term];
    this.filteredCommodities.set(this.allCommodities().filter(c => {
      const name = c.name.toLowerCase();
      const code = c.code.toLowerCase();
      return searchTerms.some(t => name.includes(t) || code.includes(t))
        && !this.editCommodities().includes(c.code);
    }));
    this.showSuggestions.set(true);
  }

  selectCommodity(commodity: Commodity): void {
    if (!this.editCommodities().includes(commodity.code)) {
      this.editCommodities.update(c => [...c, commodity.code]);
    }
    this.newCommodity.set('');
    this.filteredCommodities.set([]);
    this.showSuggestions.set(false);
  }

  selectFirstSuggestion(): void {
    if (this.filteredCommodities().length > 0) {
      this.selectCommodity(this.filteredCommodities()[0]);
    }
  }

  clearZeroOnFocus(field: 'editAcres' | 'editBinCapacity'): void {
    if (this[field] === '0') {
      this[field] = '';
    }
  }

  normalizeNumericOnBlur(field: 'editAcres' | 'editBinCapacity'): void {
    const num = this._parseNumericInput(this[field]);
    this[field] = String(num);
  }

  private _parseNumericInput(value: string): number {
    const digits = value.replace(/[^0-9]/g, '');
    const num = parseInt(digits, 10);
    return isNaN(num) ? 0 : num;
  }

  clearCommoditySearch(): void {
    this.newCommodity.set('');
    this.filteredCommodities.set([]);
    this.showSuggestions.set(false);
  }

  hideSuggestionsDelayed(): void {
    // Delay to allow mousedown on suggestion to fire first
    setTimeout(() => { this.showSuggestions.set(false); }, 200);
  }

  private _loadAllProducersForSearch(): void {
    this.isLoadingProducers.set(true);
    this.apiService.getTradeUnits().pipe(
      switchMap(tradeUnits => this.apiService.getCustomers(tradeUnits))
    ).subscribe({
      next: (customers) => {
        this._allProducersForSearch = customers;
        this.isLoadingProducers.set(false);
        // If the user already typed in the search box, refresh results now that data is loaded
        if (this.newProducerSearch().trim()) {
          this.onProducerSearch();
        }
      },
      error: () => {
        this.isLoadingProducers.set(false);
      }
    });
  }

  private get _producerPool(): Customer[] {
    // No trade units selected → use the full cross-trade-unit cache
    // Trade units selected → use the already-loaded filtered list (instant, no extra API call)
    return this.selectedTradeUnits().length === 0
      ? this._allProducersForSearch
      : this.allCustomers();
  }

  getProducerById(producerId: string): Customer | undefined {
    return this._producerPool.find(c => c.sourceCustomerId === producerId)
      ?? this.linkedCustomers().find(c => c.sourceCustomerId === producerId)
      ?? this.allCustomers().find(c => c.sourceCustomerId === producerId);
  }

  getProducersLinkingToMe(): Customer[] {
    if (!this.customer()) return [];
    const mySourceId = this.customer()!.sourceCustomerId || '';
    return this._producerPool.filter(c =>
      c.linkedProducerIds &&
      c.linkedProducerIds.includes(mySourceId) &&
      !this.removedIncomingIds().includes(c.sourceCustomerId || '')
    );
  }

  onProducerSearch(): void {
    const term = this.newProducerSearch().trim().toLowerCase();
    if (!term) {
      this.filteredProducers.set([]);
      return;
    }
    const currentCustomer = this.customer();
    this.filteredProducers.set(this._producerPool.filter(c =>
      c.id !== currentCustomer?.id &&
      !this.editLinkedProducerIds().includes(c.sourceCustomerId || '') &&
      (
        c.name.toLowerCase().includes(term) ||
        c.id.toString().includes(term) ||
        (c.sourceCustomerId || '').toLowerCase().includes(term)
      )
    ));
    this.showProducerSuggestions.set(true);
  }

  selectProducer(producer: Customer): void {
    const idStr = producer.sourceCustomerId || producer.id.toString();
    if (!this.editLinkedProducerIds().includes(idStr)) {
      this.editLinkedProducerIds.update(ids => [...ids, idStr]);
    }
    this.newProducerSearch.set('');
    this.filteredProducers.set([]);
    this.showProducerSuggestions.set(false);
  }

  hideProducerSuggestionsDelayed(): void {
    setTimeout(() => { this.showProducerSuggestions.set(false); }, 200);
  }

  removeLinkedProducer(producerId: string): void {
    this.editLinkedProducerIds.update(ids => ids.filter(id => id !== producerId));
  }

  removeIncomingLink(producerId: string): void {
    if (!this.removedIncomingIds().includes(producerId)) {
      this.removedIncomingIds.update(ids => [...ids, producerId]);
    }
  }

  onCancel(): void {
    // Reset all fields back to original values
    this.editAcres = String(this._originalAcres || 0);
    this.editBinCapacity = String(this._originalBinCapacity || 0);
    this.editCommodities.set([...this._originalCommodities]);
    this.editLinkedProducerIds.set([...this._originalLinkedProducerIds]);
    this.removedIncomingIds.set([]);
    this.editESignEnabled.set(this._originalESignEnabled);
    this.editPrimaryContact.set(this._originalPrimaryContact);
    this.newCommodity.set('');
    this.filteredCommodities.set([]);
    this.showSuggestions.set(false);
    this.newProducerSearch.set('');
    this.filteredProducers.set([]);
    this.showProducerSuggestions.set(false);
    this._initialized = false;
    this.close.emit();
  }

  onSave(): void {
    const customer = this.customer();
    if (customer) {
      // Only save user-added commodities to ProducerDetails — ticket-derived ones are
      // always re-derived fresh from current tickets, so they should never be persisted.
      this.save.emit({
        customerId: customer.id,
        acres: this._parseNumericInput(this.editAcres),
        binCapacity: this._parseNumericInput(this.editBinCapacity),
        commodities: this.editCommodities().filter(c => !this.isTicketCommodity(c)),
        primaryContact: this.editPrimaryContact().slice(0, 200),
        linkedProducerIds: this.editLinkedProducerIds(),
        removedIncomingIds: this.removedIncomingIds(),
        eSignEnabled: this.editESignEnabled()
      });
      this._initialized = false;
      this.close.emit();
    }
  }
}
