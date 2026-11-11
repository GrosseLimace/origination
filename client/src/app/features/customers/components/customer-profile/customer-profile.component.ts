import { Component, input, output, inject, effect, computed, ChangeDetectionStrategy, ViewChild, ElementRef, signal, Injector, Signal, runInInjectionContext, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '@core/services/theme.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { Customer } from '@models';
import { formatPhoneDisplay } from '@shared/utils/phone';
import { resolveCustomerAddress, formatAddressLine, googleMapsSearchUrl } from '@shared/utils/address';
import { SelectedCustomerContext } from '@core/context/selected-customer-context.service';
import { CustomerTab } from '@core/modules/module-manifest';
import { ModuleRegistry } from '@core/modules/module-registry';
import { CustomerContributionComponent } from '@core/modules/customer-contribution.component';
import { CustomerSlotComponent } from '@core/modules/customer-slot.component';

/** One tab in the producer profile's tab strip, with its count badge. */
interface ProfileTab {
  id: string;
  label: string;
  shortLabel: string;
  /** The count beside the label, or null for none. */
  count: number | null;
  /** Position in the strip, lowest first. */
  order: number;
  /** The module tab this is. */
  contribution: CustomerTab;
}

@Component({
  selector: 'app-customer-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    CustomerContributionComponent,
    CustomerSlotComponent
  ],
  templateUrl: './customer-profile.component.html',
})
export class CustomerProfileComponent {
  public customer = input.required<Customer>();

  /** True when the contracts table wants the page at full width (columns expanded on the
   *  contracts tab) so the host page can drop the Notes sidebar below the profile. */
  public onContractsWideChange = output<boolean>();
  public linkedCustomers = input<Customer[]>([]);
  public onSelectLinkedCustomer = output<number>();
  public openTab = input<string | null>(null);

  @ViewChild('tabsSection') private tabsSectionRef?: ElementRef<HTMLElement>;

  private readonly themeService = inject(ThemeService);
  private readonly usageTracking = inject(UsageTrackingService);

  trackCallClick(): void {
    this.usageTracking.trackCallClick(this.customer().id.toString());
  }

  trackEmailClick(): void {
    this.usageTracking.trackEmailClick(this.customer().id.toString());
  }

  trackMapClick(): void {
    this.usageTracking.trackMapClick(this.customer().id.toString());
  }

  // Local state - signals
  activeTab = signal('contracts');
  showESignRecipients = signal(false);

  private readonly registry = inject(ModuleRegistry);
  private readonly context = inject(SelectedCustomerContext);
  private readonly injector = inject(Injector);

  constructor() {
    effect(() => {
      // A tab that needs the page's full width (the contracts table with its extra columns open) says so through the
      // context, and clears it when it closes; the page drops its sidebar meanwhile.
      this.onContractsWideChange.emit(this.context.wideContent());
    });

    effect(() => {
      // When arriving from Insights with a specific contract, switch to contracts tab
      // (contracts-table handles scrolling to the specific row)
      const openContractId = this.context.link().contractId;
      if (openContractId != null) {
        this.activeTab.set('contracts');
      }
    });

    effect(() => {
      // When arriving from Insights with a requested tab (e.g. 'tickets' for Spot Loads), switch to it
      const tab = this.openTab();
      if (tab) {
        this.activeTab.set(tab);
        setTimeout(() => {
          this.tabsSectionRef?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      }
    });

    effect(() => {
      // The eSign recipients panel closes when switching customers. (The crop year being looked at is
      // SelectedProducerProduction's, which the page's selection starts over.)
      this.customer();
      this.showESignRecipients.set(false);
    });
  }

  selectTab(tabId: string): void {
    this.activeTab.set(tabId);
    // Track tab clicks for usage dashboard
    if (tabId === 'planting') this.usageTracking.trackPlantingTabClick();
    if (tabId === 'storage') this.usageTracking.trackStorageDropdownOpen(this.customer().id.toString());
    if (tabId === 'dpContracts') this.usageTracking.trackDpContractsDropdownOpen(this.customer().id.toString());
    // Defer scroll until after Angular renders the new tab content — otherwise the DOM
    // still shows the old (tall) tab and the scroll position doesn't update correctly.
    setTimeout(() => {
      const el = this.tabsSectionRef?.nativeElement;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 0);
  }

  /** Each module tab's count, created once, in the profile's injection context. */
  private readonly tabBadges = new Map<CustomerTab, Signal<number | null>>();

  private badgeOf(tab: CustomerTab): Signal<number | null> | null {
    if (!tab.badge) return null;
    let badge = this.tabBadges.get(tab);
    if (!badge) {
      badge = untracked(() => runInInjectionContext(this.injector, tab.badge!));
      this.tabBadges.set(tab, badge);
    }
    return badge;
  }

  /** The tab strip: the modules' tabs the user may see for this customer, in order. */
  readonly tabs = computed<ProfileTab[]>(() => this.registry.customerTabs()
    .filter(tab => this.context.appliesTo(tab))
    .map(tab => ({ id: tab.id, label: tab.label, shortLabel: tab.shortLabel, count: this.badgeOf(tab)?.() ?? null, order: tab.order, contribution: tab })));

  /** The tab shown: the one picked, or the first when the picked one isn't in the strip (its module's tab isn't
   *  shown to this user or for this customer). */
  readonly shownTab = computed(() => {
    const tabs = this.tabs();
    const picked = this.activeTab();
    return tabs.some(tab => tab.id === picked) ? picked : (tabs[0]?.id ?? null);
  });

  /** The tab being shown, or null when the strip is empty. */
  readonly shownContribution = computed(() => this.tabs().find(tab => tab.id === this.shownTab())?.contribution ?? null);

  get isDarkMode(): boolean {
    return this.themeService.isDarkMode();
  }

  getTabClass(tabId: string): string {
    const isActive = this.shownTab() === tabId;
    const baseClass = 'flex-1 text-center px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 border-0 outline-none';

    if (isActive) {
      return `${baseClass} bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm`;
    }
    return `${baseClass} bg-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white`;
  }

  /** Splits ScoularView recipients string into individual entries.
   *  Handles commas inside names (e.g., "Ade, Clay 785-555-1234") by only splitting
   *  on commas that separate complete name+phone pairs. */
  parseRecipients(raw: string): string[] {
    const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
    const results: string[] = [];
    let buffer = '';
    for (const part of parts) {
      if (buffer) {
        buffer += ', ' + part;
      } else {
        buffer = part;
      }
      // A complete recipient has a phone number (3+ consecutive digits)
      if (/\d{3}/.test(buffer)) {
        results.push(buffer);
        buffer = '';
      }
    }
    // If anything remains without a phone number, attach it to the last entry or add as-is
    if (buffer) {
      if (results.length > 0) {
        results[results.length - 1] += ', ' + buffer;
      } else {
        results.push(buffer);
      }
    }
    return results;
  }

  /** The current customer's ScoularView recipients, parsed once per customer for the eSign panel. */
  readonly scoularViewRecipientList = computed(() => {
    const raw = this.customer().scoularViewRecipients;
    return raw ? this.parseRecipients(raw) : [];
  });

  /** Displayed producer address. Extended fields win over Merchandising and the ZIP is included,
   *  so the text matches the address the producer map actually pins. */
  getContactAddress(): string {
    return formatAddressLine(resolveCustomerAddress(this.customer()));
  }

  /** Google Maps deep link for the displayed address, or null when there is too little to search on. */
  getMapsUrl(): string | null {
    return googleMapsSearchUrl(resolveCustomerAddress(this.customer()));
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
    return formatPhoneDisplay(this.getCustomerPhone());
  }
}
