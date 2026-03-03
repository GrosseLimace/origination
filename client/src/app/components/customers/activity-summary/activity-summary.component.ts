import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain } from '../../../models';

@Component({
  selector: 'app-activity-summary',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'block' },
  template: `
    <div class="rounded-xl border border-green-200 dark:border-green-800 overflow-hidden">
      <div class="bg-green-50 dark:bg-green-900/20 p-6">
        <div class="flex items-center gap-2 mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-600 dark:text-green-400">
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
            <path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
          </svg>
          <h3 class="font-semibold text-lg text-green-600 dark:text-green-400">Activity Summary</h3>
        </div>
        <p class="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">
          {{ summaryText }}
        </p>
      </div>
    </div>
  `
})
export class ActivitySummaryComponent implements OnChanges {
  @Input() customer!: Customer;
  @Input() contracts: Contract[] = [];
  @Input() tickets: Ticket[] = [];
  @Input() plantingIntentions: PlantingIntention[] = [];
  @Input() notes: Note[] = [];
  @Input() storedGrain: StoredGrain[] = [];
  @Input() allCustomers: Customer[] = [];

  summaryText = '';

  ngOnChanges(changes: SimpleChanges): void {
    this.summaryText = this.generateSummaryParagraph();
  }

  private generateSummaryParagraph(): string {
    try {
      const paragraphs: string[] = [];

      paragraphs.push(this.generateCustomerIntro());
      paragraphs.push(this.generateContractSummary());
      paragraphs.push(this.generatePlantingOverview());
      paragraphs.push(this.generateStorageSummary());
      paragraphs.push(this.generateDeliverySummary());
      paragraphs.push(this.generateEngagementSummary());
      paragraphs.push(this.generateActionItems());

      const filtered = paragraphs.filter(s => s && s.length > 0);

      if (filtered.length === 0) {
        return 'No activity data available for this customer.';
      }

      return filtered.join(' ');
    } catch (error) {
      return 'Unable to generate activity summary at this time.';
    }
  }

  private generateCustomerIntro(): string {
    if (!this.customer) return '';

    const name = this.customer.name || 'This customer';
    const acres = this.customer.totalAcres || 0;
    const binCapacity = this.customer.binCapacity || 0;
    const farm = this.customer.farm || '';
    const primaryContact = this.customer.primaryContact || '';
    const commodities = this.customer.commodities || [];
    const linkedGroup = this.getLinkedGroup();

    const commStr = commodities.length === 1
      ? commodities[0]
      : commodities.length > 1
        ? commodities.slice(0, -1).join(', ') + ' and ' + commodities[commodities.length - 1]
        : '';

    const parts: string[] = [];

    // Opening sentence — who they are
    let opening = name;
    if (acres > 0 && farm && farm !== 'Unknown Farm') {
      opening += ` operates ${this.formatQuantity(acres, 'acres')} at ${farm}`;
    } else if (acres > 0) {
      opening += ` operates ${this.formatQuantity(acres, 'acres')}`;
    } else if (farm && farm !== 'Unknown Farm') {
      opening += ` farms at ${farm}`;
    }
    if (commStr) opening += `, primarily growing ${commStr}`;
    parts.push(opening + '.');

    // Contact + bin capacity
    const details: string[] = [];
    if (primaryContact) details.push(`primary contact is ${primaryContact}`);
    if (binCapacity > 0) details.push(`${this.formatQuantity(binCapacity, 'bushels')} of on-farm bin capacity`);
    if (details.length > 0) {
      parts.push(details.map((d, i) => i === 0 ? d.charAt(0).toUpperCase() + d.slice(1) : d).join(', ') + '.');
    }

    // Linked producers
    if (linkedGroup.length === 1) {
      parts.push(`Linked with ${linkedGroup[0].name}${linkedGroup[0].sourceCustomerId ? ' (' + linkedGroup[0].sourceCustomerId + ')' : ''}.`);
    } else if (linkedGroup.length >= 2) {
      const names = linkedGroup.map(p => p.name).join(' and ');
      parts.push(`Linked with ${names}.`);
    }

    return parts.join(' ');
  }

  private getLinkedGroup(): Customer[] {
    if (!this.customer || !this.allCustomers) return [];
    const mySourceId = this.customer.sourceCustomerId || '';
    const outgoing = (this.customer.linkedProducerIds || [])
      .map(id => this.allCustomers.find(c => c.sourceCustomerId === id))
      .filter((c): c is Customer => !!c);
    const incoming = this.allCustomers.filter(c =>
      mySourceId && (c.linkedProducerIds || []).includes(mySourceId)
    );
    return [...new Map([...outgoing, ...incoming].map(c => [c.id, c])).values()]
      .filter(c => c.id !== this.customer.id);
  }

  private generateContractSummary(): string {
    if (!this.contracts || this.contracts.length === 0) return '';

    const now = new Date();
    const activeContracts = this.contracts.filter(c => c && c.status === 'Active');
    const pendingContracts = this.contracts.filter(c => c && c.status === 'Pending');
    const fulfilledContracts = this.contracts.filter(c => c && c.status === 'Fulfilled');
    const unsignedContracts = this.contracts.filter(c => c && c.signed === false);

    const overdueContracts = this.contracts.filter(c => {
      if (!c || !c.deliveryEnd) return false;
      try {
        const endDate = new Date(c.deliveryEnd);
        return !isNaN(endDate.getTime()) && (c.status === 'Active' || c.status === 'Pending') && endDate < now;
      } catch { return false; }
    });

    if (activeContracts.length === 0 && fulfilledContracts.length === 0) return '';

    const parts: string[] = [];
    const activeVolume = activeContracts.reduce((sum, c) => sum + (c.quantity || 0), 0);
    const activeValue = activeContracts.reduce((sum, c) => sum + (c.totalValue || 0), 0);

    // Determine current crop year from contracts (max = newest/upcoming crop year).
    // CropYear is when the grain was grown, not when the contract was signed.
    // Using max ensures we reference the newest crop, not old crop which may dominate by volume.
    let currentCropYear: number | null = null;
    for (const c of this.contracts) {
      if (c.cropYear && (currentCropYear === null || c.cropYear > currentCropYear)) {
        currentCropYear = c.cropYear;
      }
    }

    // Open balance: sum openBalanceQuantity from active contracts for current crop year
    const currentYearActiveContracts = currentCropYear
      ? activeContracts.filter(c => c.cropYear === currentCropYear)
      : activeContracts;
    const totalOpenBalance = currentYearActiveContracts.reduce((sum, c) => sum + (c.openBalanceQuantity || 0), 0);

    if (activeContracts.length > 0) {
      const cropYearStr = currentCropYear ? ` (CY${currentCropYear})` : '';
      parts.push(`On the contract side, they currently have ${activeContracts.length} active contract${activeContracts.length !== 1 ? 's' : ''}${cropYearStr} totaling ${this.formatQuantity(activeVolume, 'bushels')} — worth ${this.formatCurrency(activeValue)}.`);
      if (totalOpenBalance > 0) {
        parts.push(`${this.formatQuantity(Math.round(totalOpenBalance), 'bushels')} remain unshipped.`);
      }
    } else {
      parts.push(`All ${fulfilledContracts.length} contract${fulfilledContracts.length !== 1 ? 's have' : ' has'} been fulfilled.`);
    }

    const notes: string[] = [];
    if (pendingContracts.length > 0) notes.push(`${pendingContracts.length} pending`);
    if (overdueContracts.length > 0) notes.push(`${overdueContracts.length} past their delivery deadline`);
    if (unsignedContracts.length > 0) notes.push(`${unsignedContracts.length} still awaiting signature`);

    if (notes.length > 0) {
      parts.push(`Worth noting: ${notes.join(', ')}.`);
    }

    return parts.join(' ');
  }

  private generatePlantingOverview(): string {
    if (!this.plantingIntentions || this.plantingIntentions.length === 0) return '';

    // Group by crop with null safety
    const cropGroups = this.plantingIntentions.reduce((acc, p) => {
      if (!p || !p.crop) return acc; // Skip invalid entries

      const crop = p.crop;
      if (!acc[crop]) {
        acc[crop] = { acres: 0 };
      }
      acc[crop].acres += p.acres || 0;
      return acc;
    }, {} as Record<string, { acres: number }>);

    // Check if we have valid data after filtering
    if (Object.keys(cropGroups).length === 0) return '';

    // Planting details with natural flow
    const cropEntries = Object.entries(cropGroups);
    let crops: string;

    if (cropEntries.length === 1) {
      const [crop, data] = cropEntries[0];
      crops = `${this.formatQuantity(data.acres, 'acres')} of ${crop}`;
    } else if (cropEntries.length === 2) {
      crops = cropEntries.map(([crop, data]) => `${this.formatQuantity(data.acres, 'acres')} of ${crop}`).join(' and ');
    } else {
      const lastCrop = cropEntries[cropEntries.length - 1];
      const otherCrops = cropEntries.slice(0, -1);
      crops = otherCrops.map(([crop, data]) => `${this.formatQuantity(data.acres, 'acres')} of ${crop}`).join(', ') +
              `, and ${this.formatQuantity(lastCrop[1].acres, 'acres')} of ${lastCrop[0]}`;
    }

    return `Planting intentions on file: ${crops}.`;
  }

  private generateStorageSummary(): string {
    if (!this.storedGrain || this.storedGrain.length === 0) return '';

    const totalStored = this.storedGrain.reduce((sum, s) => sum + (s?.quantity || 0), 0);

    // Average storage duration with date validation
    const validGrain = this.storedGrain.filter(s => s && s.storageStartDate);
    if (validGrain.length === 0) return '';

    const avgDays = validGrain.reduce((sum, s) => {
      try {
        const startDate = new Date(s.storageStartDate);
        // Validate date is valid and not in the future
        if (isNaN(startDate.getTime()) || startDate > new Date()) return sum;
        const days = this.calculateDaysBetween(startDate, new Date());
        return sum + Math.max(0, days); // Ensure non-negative
      } catch {
        return sum;
      }
    }, 0) / validGrain.length;

    return `Currently holding ${this.formatQuantity(totalStored, 'bushels')} in on-farm storage, averaging ${Math.floor(avgDays)} days in.`;
  }

  private generateDeliverySummary(): string {
    if (!this.tickets || this.tickets.length === 0) return '';

    const totalTickets = this.tickets.length;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const recentTickets = this.tickets.filter(t => {
      if (!t || !t.date) return false;
      try {
        const ticketDate = new Date(t.date);
        return !isNaN(ticketDate.getTime()) && ticketDate >= thirtyDaysAgo;
      } catch {
        return false;
      }
    });

    const last90Days = this.tickets.filter(t => {
      if (!t || !t.date) return false;
      try {
        const ticketDate = new Date(t.date);
        return !isNaN(ticketDate.getTime()) && ticketDate >= ninetyDaysAgo;
      } catch {
        return false;
      }
    });

    if (recentTickets.length > 0) {
      const totalDelivered = recentTickets.reduce((sum, t) => sum + (t.netWeight || 0), 0);
      const parts: string[] = [];
      parts.push(`${recentTickets.length} delivery ticket${recentTickets.length !== 1 ? 's' : ''} in the last 30 days totaling ${this.formatQuantity(totalDelivered, 'lbs')}.`);

      const ticketsWithMoisture = recentTickets.filter(t => typeof t.moisture === 'number' && !isNaN(t.moisture) && t.moisture > 0);
      const ticketsWithTestWeight = recentTickets.filter(t => typeof t.testWeight === 'number' && !isNaN(t.testWeight) && t.testWeight > 0);
      if (ticketsWithMoisture.length > 0 && ticketsWithTestWeight.length > 0) {
        const avgMoisture = ticketsWithMoisture.reduce((sum, t) => sum + (t.moisture || 0), 0) / ticketsWithMoisture.length;
        const avgTestWeight = ticketsWithTestWeight.reduce((sum, t) => sum + (t.testWeight || 0), 0) / ticketsWithTestWeight.length;
        parts.push(`Avg quality: ${avgMoisture.toFixed(1)}% moisture, ${avgTestWeight.toFixed(1)} lbs/bu test weight.`);
      }

      return parts.join(' ');
    } else if (last90Days.length > 0) {
      const total90Days = last90Days.reduce((sum, t) => sum + (t.netWeight || 0), 0);
      return `${last90Days.length} deliver${last90Days.length !== 1 ? 'ies' : 'y'} in the past 90 days (${this.formatQuantity(total90Days, 'lbs')}), none in the last 30 days.`;
    } else {
      return `${totalTickets} delivery ticket${totalTickets !== 1 ? 's' : ''} on record, no activity in the past 90 days.`;
    }
  }

  private generateEngagementSummary(): string {
    if (!this.notes || this.notes.length === 0) return '';

    // Only consider notes that belong to this customer — not linked farms.
    const ownNotes = this.customer ? this.notes.filter(n => n && n.customerId === this.customer.id) : this.notes;

    // Filter valid notes with dates
    const validNotes = ownNotes.filter(n => n && n.createdAt);
    if (validNotes.length === 0) return '';

    // Last contact with error handling
    try {
      const sorted = [...validNotes].sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        // Handle invalid dates
        if (isNaN(dateA)) return 1;
        if (isNaN(dateB)) return -1;
        return dateB - dateA;
      });

      const lastNote = sorted[0];
      if (!lastNote) return '';

      const raw = typeof lastNote.createdAt === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(lastNote.createdAt as any)
        ? (lastNote.createdAt as any) + 'Z' : lastNote.createdAt;
      const lastDate = new Date(raw);
      if (isNaN(lastDate.getTime())) return '';

      const daysSince = this.calculateDaysBetween(lastDate, new Date());
      const createdBy = lastNote.createdBy || 'Unknown';

      if (daysSince === 0) {
        return `Last contact was today by ${createdBy}.`;
      } else if (daysSince === 1) {
        return `Last contact was yesterday by ${createdBy}.`;
      } else if (daysSince <= 7) {
        return `Last contact was ${Math.abs(daysSince)} days ago by ${createdBy}.`;
      } else if (daysSince <= 30) {
        return `Last contact was ${Math.abs(daysSince)} days ago by ${createdBy}.`;
      } else {
        return `Last contact was ${Math.abs(daysSince)} days ago by ${createdBy}.`;
      }
    } catch {
      return '';
    }
  }

  private generateActionItems(): string {
    if (!this.contracts || this.contracts.length === 0) return '';

    const now = new Date();
    const alerts: string[] = [];

    // Check for overdue contracts with date validation
    const overdueContracts = this.contracts.filter(c => {
      if (!c || !c.deliveryEnd) return false;
      try {
        const endDate = new Date(c.deliveryEnd);
        return !isNaN(endDate.getTime()) &&
               (c.status === 'Active' || c.status === 'Pending') &&
               endDate < now;
      } catch {
        return false;
      }
    });

    if (overdueContracts.length > 0) {
      const openBalance = overdueContracts.reduce((sum, c) => sum + (c.openBalanceQuantity || 0), 0);
      const balanceStr = openBalance > 0 ? ` with ${this.formatQuantity(Math.round(openBalance), 'bushels')} still unshipped` : '';
      alerts.push(`${overdueContracts.length} contract${overdueContracts.length !== 1 ? 's have' : ' has'} passed the delivery deadline${balanceStr}`);
    }

    const unsignedContracts = this.contracts.filter(c => c && c.signed === false);
    if (unsignedContracts.length > 0) {
      alerts.push(`${unsignedContracts.length} contract${unsignedContracts.length !== 1 ? 's are' : ' is'} still unsigned`);
    }

    const upcomingDeliveries = this.contracts
      .filter(c => {
        if (!c || !c.deliveryEnd || c.status !== 'Active') return false;
        try {
          const endDate = new Date(c.deliveryEnd);
          return !isNaN(endDate.getTime()) && endDate >= now;
        } catch { return false; }
      })
      .sort((a, b) => new Date(a.deliveryEnd).getTime() - new Date(b.deliveryEnd).getTime());

    if (upcomingDeliveries.length > 0) {
      const nextContract = upcomingDeliveries[0];
      try {
        const daysRemaining = this.calculateDaysBetween(now, new Date(nextContract.deliveryEnd));
        if (daysRemaining <= 30 && daysRemaining >= 0) {
          const crop = nextContract.commodityCode || nextContract.commodityDescription || 'grain';
          if (daysRemaining <= 7) {
            alerts.push(`their ${crop} delivery window closes in just ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`);
          } else {
            alerts.push(`their next ${crop} delivery deadline is ${daysRemaining} days away`);
          }
        }
      } catch { }
    }

    if (alerts.length === 0) return '';
    if (alerts.length === 1) return alerts[0].charAt(0).toUpperCase() + alerts[0].slice(1) + '.';
    const last = alerts[alerts.length - 1];
    const rest = alerts.slice(0, -1).join(', ');
    return rest.charAt(0).toUpperCase() + rest.slice(1) + ', and ' + last + '.';
  }

  // Helper utility methods

  private formatCurrency(value: number): string {
    // Handle null, undefined, NaN, and Infinity
    if (value == null || isNaN(value) || !isFinite(value)) {
      return '$0.00';
    }
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private formatQuantity(value: number, unit: string): string {
    // Handle null, undefined, NaN, and Infinity
    if (value == null || isNaN(value) || !isFinite(value)) {
      return `0 ${unit}`;
    }
    return `${value.toLocaleString('en-US')} ${unit}`;
  }

  private calculateDaysBetween(start: Date, end: Date): number {
    // Validate dates
    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
      return 0;
    }
    return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }

}
