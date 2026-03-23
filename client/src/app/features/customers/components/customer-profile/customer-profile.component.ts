import { Component, input, output, inject, effect, ChangeDetectionStrategy, ViewChild, ElementRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '@core/services/theme.service';
import { ContractsTableComponent } from '../contracts-table/contracts-table.component';
import { TicketsTableComponent } from '../tickets-table/tickets-table.component';
import { PlantingIntentionsTableComponent } from '../planting-intentions-table/planting-intentions-table.component';
import { StoredGrainTableComponent } from '../stored-grain-table/stored-grain-table.component';
import { ProducerInsightsComponent } from '../producer-insights/producer-insights.component';
import { ContractPacingCardComponent } from '../contract-pacing-card/contract-pacing-card.component';
import { AIGrowthForecastComponent } from '../ai-growth-forecast/ai-growth-forecast.component';
import { ActivitySummaryComponent } from '../activity-summary/activity-summary.component';
import { EditCustomerDialogComponent } from '../edit-customer-dialog/edit-customer-dialog.component';
import { Customer, Contract, Ticket, PlantingIntention, StoredGrain, Note, ContractPricingLine, DashboardPlantingEstimate, Commodity } from '@models';

@Component({
  selector: 'app-customer-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ContractsTableComponent,
    TicketsTableComponent,
    PlantingIntentionsTableComponent,
    StoredGrainTableComponent,
    ProducerInsightsComponent,
    ContractPacingCardComponent,
    AIGrowthForecastComponent,
    ActivitySummaryComponent,
    EditCustomerDialogComponent
  ],
  templateUrl: './customer-profile.component.html'
})
export class CustomerProfileComponent {
  public customer = input.required<Customer>();
  public allCustomers = input<Customer[]>([]);
  public selectedTradeUnits = input<string[]>([]);
  public contracts = input<Contract[]>([]);
  public tickets = input<Ticket[]>([]);
  public pricingLines = input<ContractPricingLine[]>([]);
  public plantingIntentions = input<PlantingIntention[]>([]);
  public storedGrain = input<StoredGrain[]>([]);
  public notes = input<Note[]>([]);
  public yieldEstimateCrops = input<string[]>([]);
  public yieldEstimates = input<DashboardPlantingEstimate[]>([]);
  public commodities = input<Commodity[]>([]);
  public isLoadingEstimates = input(false);
  public isLoadingContracts = input(false);
  public isLoadingTickets = input(false);
  public isLoadingPlanting = input(false);
  public isLoadingStoredGrain = input(false);

  // Unfiltered data for Activity Summary
  public allCustomerContracts = input<Contract[]>([]);
  public allCustomerTickets = input<Ticket[]>([]);
  public allCustomerPlantingIntentions = input<PlantingIntention[]>([]);
  public allCustomerStoredGrain = input<StoredGrain[]>([]);

  public onAddPlanting = output<{crop: string, type?: string, description?: string, acres: number, plantingYear: number, tradeUnit: string}>();
  public onEditPlanting = output<{intentionId: number, crop: string, type?: string, description?: string, acres: number, plantingYear: number}>();
  public onDeletePlanting = output<number>();
  public onAddNote = output<string>();
  public onTogglePin = output<Note>();
  public onSaveCustomer = output<{ customerId: number; acres: number; binCapacity: number; commodities: string[]; primaryContact: string; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean }>();
  public linkedCustomers = input<Customer[]>([]);
  public onSelectLinkedCustomer = output<number>();
  public openContractId = input<number | null>(null);

  @ViewChild(PlantingIntentionsTableComponent) private plantingTable?: PlantingIntentionsTableComponent;
  @ViewChild('tabsSection') private tabsSectionRef?: ElementRef<HTMLElement>;

  private readonly themeService = inject(ThemeService);

  // Local state - signals
  activeTab = signal('contracts');
  showProducerInsights = signal(false);
  showESignRecipients = signal(false);
  showEditDialog = signal(false);
  selectedPlantingYear = signal(0); // 0 = auto (newest)
  private _yearUserSelected = false; // true only when user explicitly clicks a year tab

  constructor() {
    effect(() => {
      // When arriving from Insights with a specific contract, switch to contracts tab and scroll to it
      const openContractId = this.openContractId();
      if (openContractId != null) {
        this.activeTab.set('contracts');
        // Defer scroll until after Angular renders the tab switch
        setTimeout(() => {
          this.tabsSectionRef?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      }
    });

    effect(() => {
      // Reset eSign recipients panel and year selection when switching customers
      const _customer = this.customer();
      this.showESignRecipients.set(false);
      this._yearUserSelected = false;
      this.selectedPlantingYear.set(0);
    });

    effect(() => {
      // Derive available planting years from intentions + contracts
      const plantingIntentions = this.plantingIntentions();
      const contracts = this.contracts();
      const yearSet = new Set<number>();
      for (const pi of plantingIntentions) {
        if (pi.plantingYear) yearSet.add(pi.plantingYear);
      }
      for (const c of contracts) {
        if (c.cropYear) yearSet.add(c.cropYear);
      }
      this._availablePlantingYears = [...yearSet].sort((a, b) => b - a);

      // Always pick newest when user hasn't manually chosen a year.
      // Without this, contracts (2025) loading before planting intentions (2026) causes
      // the year to lock on 2025 and never update when 2026 arrives.
      const selected = this._yearUserSelected ? this.selectedPlantingYear() : 0;
      const year = (selected > 0 && yearSet.has(selected))
        ? selected
        : (this._availablePlantingYears[0] || 0);
      if (year !== selected) {
        this.selectedPlantingYear.set(year);
      }
      this._contractYear = year;

      // Recalculate total contracted bushels scoped to the selected year
      this._totalContracted = contracts
        .filter(c => c.status !== 'Cancelled' && (year === 0 || c.cropYear === year))
        .reduce((sum, c) => sum + c.quantity, 0);

      // Recalculate projected yield
      const intentionsForYear = year > 0
        ? plantingIntentions.filter(pi => pi.plantingYear === year)
        : plantingIntentions;
      const commodities = this.commodities();
      const yieldEstimates = this.yieldEstimates();
      this._totalProjectedYield = intentionsForYear.reduce((sum, pi) => {
        const commodity = commodities.find(c => c.code === pi.crop);
        const category = commodity?.category || pi.crop;
        const cropKey = [pi.type, category].filter(Boolean).join(' ');
        // Match yield estimate by crop key AND year (fallback to any year for that crop)
        const est = yieldEstimates.find(ye => ye.crop === cropKey && ye.plantingYear === year)
          || yieldEstimates.find(ye => ye.crop === cropKey);
        return sum + pi.acres * (est?.yieldEstimate ?? 0);
      }, 0);

      this._marketSharePercentage = this._totalProjectedYield > 0
        ? (this._totalContracted / this._totalProjectedYield) * 100
        : 0;
      this._bushelsAvailable = Math.max(0, this._totalProjectedYield - this._totalContracted);
    });

    effect(() => {
      // Contract pacing: delivery-year YoY % change
      const contracts = this.contracts();
      let maxYear = 0;
      for (const c of contracts) {
        if (c.deliveryStart) {
          const y = new Date(c.deliveryStart).getFullYear();
          if (y > maxYear) maxYear = y;
        }
      }
      this._pacingDeliveryYear = maxYear;

      if (maxYear > 0) {
        const priorYear = maxYear - 1;
        const today = new Date();
        const samePointLastYear = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
        const thisYearBu = contracts
          .filter(c => c.deliveryStart && new Date(c.deliveryStart).getFullYear() === maxYear)
          .reduce((sum, c) => sum + c.quantity, 0);
        const lastYearBu = contracts
          .filter(c => {
            if (!c.deliveryStart || new Date(c.deliveryStart).getFullYear() !== priorYear) return false;
            if (!c.contractDate) return true;
            return new Date(c.contractDate) <= samePointLastYear;
          })
          .reduce((sum, c) => sum + c.quantity, 0);
        this._pacingPct = lastYearBu > 0 ? ((thisYearBu - lastYearBu) / lastYearBu) * 100 : null;
      } else {
        this._pacingPct = null;
      }

      // Update unapplied ticket count — isApplied uses contract prefix type (P/S in ctrmContractNumber)
      const tickets = this.tickets();
      this._unappliedTicketCount = tickets.filter(t => !t.isApplied).length;

      // Update tabs cache
      this._tabs = [
        { id: 'contracts', label: 'Contracts', shortLabel: 'Cont', count: contracts.length },
        { id: 'tickets', label: 'Unapplied Tickets', shortLabel: 'Tick', count: this._unappliedTicketCount },
        { id: 'planting', label: 'Planting', shortLabel: 'Plan', count: this.plantingIntentions().length },
        { id: 'storage', label: 'Storage', shortLabel: 'Stor', count: new Set(this.storedGrain().map(g => g.crop || 'Unknown')).size }
      ];
    });

    effect(() => {
      // Rebuild effective commodities from tickets + user-added
      const tickets = this.tickets();
      const customer = this.customer();
      const ticketCommodities = [...new Set(
        tickets.map(t => t.productCode || '').filter(Boolean)
      )];
      const userCommodities = customer?.commodities || [];
      this._effectiveCommodities = [...new Set([...ticketCommodities, ...userCommodities])].sort();
    });
  }

  selectTab(tabId: string): void {
    this.activeTab.set(tabId);
    // Defer scroll until after Angular renders the new tab content — otherwise the DOM
    // still shows the old (tall) tab and the scroll position doesn't update correctly.
    setTimeout(() => {
      const el = this.tabsSectionRef?.nativeElement;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 0);
  }

  // Performance optimization: Cache computed values used in template
  private _totalProjectedYield = 0;
  private _totalContracted = 0;
  private _marketSharePercentage = 0;
  private _bushelsAvailable = 0;
  private _contractYear = 0;
  private _availablePlantingYears: number[] = [];
  private _pacingDeliveryYear = 0;
  private _pacingPct: number | null = null;
  private _tabs: any[] = [];
  private _unappliedTicketCount = 0;
  private _effectiveCommodities: string[] = [];

  toggleProducerInsights(): void {
    this.showProducerInsights.update(v => !v);
  }

  openEditDialog(): void {
    this.showEditDialog.set(true);
  }

  closeEditDialog(): void {
    this.showEditDialog.set(false);
  }

  openAddPlanting(): void {
    this.plantingTable?.openAddDialog();
  }

  handleSaveCustomer(data: { customerId: number; acres: number; binCapacity: number; commodities: string[]; primaryContact: string; linkedProducerIds: string[]; removedIncomingIds: string[]; eSignEnabled: boolean }): void {
    this.onSaveCustomer.emit(data);
    this.closeEditDialog();
  }

  get isDarkMode(): boolean {
    return this.themeService.isDarkMode();
  }

  get tabs() {
    return this._tabs;
  }

  getTabClass(tabId: string): string {
    const isActive = this.activeTab() === tabId;
    const baseClass = 'flex-1 text-center px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 border-0 outline-none';

    if (isActive) {
      return `${baseClass} bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm`;
    }
    return `${baseClass} bg-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white`;
  }

  get availablePlantingYears(): number[] {
    return this._availablePlantingYears;
  }

  selectPlantingYear(year: number): void {
    this._yearUserSelected = true;
    this.selectedPlantingYear.set(year);
  }

  get contractYear(): number {
    return this._contractYear;
  }

  get totalProjectedYield(): number {
    return this._totalProjectedYield;
  }

  get totalContracted(): number {
    return this._totalContracted;
  }

  get marketSharePercentage(): number {
    return this._marketSharePercentage;
  }

  get bushelsAvailable(): number {
    return this._bushelsAvailable;
  }

  /** Most recent delivery year seen across all contracts. */
  get yoyCurrentYear(): number { return this._pacingDeliveryYear; }

  /** YoY pacing % as display string, e.g. "+15%" or "-8%" or "—" if no prior-year data. */
  get yoyThisPctDisplay(): string {
    if (this._pacingPct === null) return '—';
    const sign = this._pacingPct >= 0 ? '+' : '';
    return `${sign}${Math.round(this._pacingPct)}%`;
  }

  /** True when pacing is strictly ahead vs prior year. */
  get yoyIsAhead(): boolean {
    return this._pacingPct !== null && this._pacingPct > 0;
  }

  /** Box classes for the Contract Pace Percentage card: green/red/neutral. */
  get pacingBoxClass(): string {
    if (this._pacingPct === null || this._pacingPct === 0) {
      return 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400';
    }
    return this._pacingPct > 0
      ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
      : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400';
  }

  get unappliedTicketCount(): number {
    return this._unappliedTicketCount;
  }

  getEffectiveCommodities(): string[] {
    return this._effectiveCommodities;
  }

  private _escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Opens a print dialog with formatted customer information */
  printCustomerInfo(): void {
    const activeContracts = this.contracts().filter(c => c.status === 'Active' || c.status === 'Pending');
    const contractValue = activeContracts.reduce((sum, c) => sum + (c.quantity * c.price), 0);

    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Customer Info - ${this._escapeHtml(this.customer().name)}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 40px; color: #000; }
          h1 { font-size: 24px; margin-bottom: 8px; color: #000; }
          h2 { font-size: 18px; margin-top: 24px; margin-bottom: 12px; border-bottom: 2px solid #000; padding-bottom: 4px; color: #000; }
          h3 { font-size: 14px; margin-top: 16px; margin-bottom: 8px; color: #000; }
          .header { margin-bottom: 24px; }
          .farm-name { color: #000; font-size: 14px; margin-bottom: 4px; }
          .print-date { color: #000; font-size: 12px; }
          .section { margin-bottom: 20px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
          .info-item { margin-bottom: 8px; }
          .label { font-weight: bold; color: #000; font-size: 12px; text-transform: uppercase; }
          .value { font-size: 14px; margin-top: 2px; color: #000; }
          .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 12px; }
          .summary-box { border: 1px solid #000; border-radius: 4px; padding: 12px; text-align: center; }
          .summary-value { font-size: 20px; font-weight: bold; color: #000; }
          .summary-label { font-size: 12px; color: #000; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
          th { background: #fff; text-align: left; padding: 10px 8px; font-weight: 600; border-bottom: 2px solid #000; color: #000; }
          td { padding: 10px 8px; border-bottom: 1px solid #000; color: #000; }
          .status { font-size: 12px; font-weight: 500; color: #000; }
          .text-right { text-align: right; }
          @media print {
            body { padding: 20px; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${this._escapeHtml(this.customer().name)}</h1>
          <div class="farm-name">${this._escapeHtml(this.customer().farm ?? '')}</div>
          <div class="print-date">Printed: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
        </div>

        <h2>Customer Information</h2>
        <div class="grid">
          <div>
            <h3>Contact</h3>
            <div class="info-item">
              <div class="label">Location</div>
              <div class="value">${this._escapeHtml(this.getFormattedLocation())}</div>
            </div>
            ${this.getCustomerPhone() ? `
            <div class="info-item">
              <div class="label">Phone</div>
              <div class="value">${this._escapeHtml(this.getFormattedPhone())}</div>
            </div>
            ` : ''}
            ${this.getCustomerEmail() ? `
            <div class="info-item">
              <div class="label">Email</div>
              <div class="value">${this._escapeHtml(this.getCustomerEmail() ?? '')}</div>
            </div>
            ` : ''}
          </div>
          <div>
            <h3>Farm Details</h3>
            <div class="info-item">
              <div class="label">Total Acres</div>
              <div class="value">${(this.customer().totalAcres || 0).toLocaleString()} acres</div>
            </div>
            ${(this.customer().binCapacity || 0) > 0 ? `
            <div class="info-item">
              <div class="label">Bin Capacity</div>
              <div class="value">${(this.customer().binCapacity || 0).toLocaleString()} bushels</div>
            </div>
            ` : ''}
            <div class="info-item">
              <div class="label">eSign Status</div>
              <div class="value">${this.customer().eSignEnabled ? 'Enrolled' : 'Not Enrolled'}</div>
            </div>
            ${this.customer().guild ? `
            <div class="info-item">
              <div class="label">Guild</div>
              <div class="value">${this._escapeHtml(this.customer().guild ?? '')}</div>
            </div>
            ` : ''}
          </div>
        </div>

        <h2>Contract Summary</h2>
        <div class="summary-grid">
          <div class="summary-box">
            <div class="summary-value">${this.totalContracted.toLocaleString()}</div>
            <div class="summary-label">Total Contracted Bushels</div>
          </div>
          <div class="summary-box">
            <div class="summary-value">${this.bushelsAvailable.toLocaleString()}</div>
            <div class="summary-label">Available Bushels</div>
          </div>
          <div class="summary-box">
            <div class="summary-value">$${contractValue.toLocaleString()}</div>
            <div class="summary-label">Contract Value</div>
          </div>
        </div>

        <h2>Active Contracts</h2>
        <div class="section">
          ${activeContracts.length > 0 ? `
          <table>
            <thead>
              <tr>
                <th>Contract #</th>
                <th>Crop</th>
                <th class="text-right">Quantity</th>
                <th class="text-right">Price</th>
                <th>Delivery Period</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${activeContracts.map(contract => `
              <tr>
                <td>${this._escapeHtml(contract.contractNumber)}</td>
                <td>${this._escapeHtml(contract.commodityDescription || contract.commodityCode || '')}</td>
                <td class="text-right">${contract.quantity.toLocaleString()} bu</td>
                <td class="text-right">$${contract.price.toFixed(2)}</td>
                <td>${this._escapeHtml(this._formatDeliveryPeriod(contract.deliveryStart, contract.deliveryEnd))}</td>
                <td><span class="status">${this._escapeHtml(contract.status ?? '')}</span></td>
              </tr>
              `).join('')}
            </tbody>
          </table>
          ` : '<p>No active contracts</p>'}
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.onload = () => {
        printWindow.print();
      };
    }
  }

  /** Formats delivery period for print display */
  private _formatDeliveryPeriod(start: Date, end: Date): string {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' });
    const endMonth = endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return `${startMonth} - ${endMonth}`;
  }

  getFormattedLocation(): string {
    const c = this.customer();
    if (!c.location && !c.stateProvince) {
      return '';
    }
    if (c.location && c.stateProvince) {
      return `${c.location}, ${c.stateProvince}`;
    }
    return c.location || c.stateProvince || '';
  }

  getCustomerPhone(): string {
    const c = this.customer();
    // Use primary phone, fallback to extended phone if primary is empty
    return c.phone || c.extendedPrimaryPhone || '';
  }

  getCustomerEmail(): string {
    const c = this.customer();
    // Use primary email, fallback to supplemental email if primary is empty
    return c.email || c.supplementalEmail || '';
  }

  getFormattedPhone(): string {
    const phone = this.getCustomerPhone();
    if (!phone) return '';
    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    // Format as (XXX) XXX-XXXX
    if (cleaned.length === 10) {
      return `(${cleaned.substring(0, 3)}) ${cleaned.substring(3, 6)}-${cleaned.substring(6)}`;
    }
    // Return original if not 10 digits
    return phone;
  }
}
