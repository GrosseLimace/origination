import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Customer, Contract, Ticket, PlantingIntention, Note, StoredGrain } from '../../../models';

type Season = 'spring' | 'summer' | 'fall' | 'winter';

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
      const sections: string[] = [];

      sections.push(this.generateCustomerIntro());
      sections.push(this.generateContractSummary());
      sections.push(this.generatePlantingOverview());
      sections.push(this.generateStorageSummary());
      sections.push(this.generateDeliverySummary());
      sections.push(this.generateEngagementSummary());
      sections.push(this.generateActionItems());

      const filteredSections = sections.filter(s => s && s.length > 0);

      if (filteredSections.length === 0) {
        return 'No activity data available for this customer.';
      }

      return filteredSections.join(' ');
    } catch (error) {
      console.error('Error generating activity summary:', error);
      return 'Unable to generate activity summary at this time.';
    }
  }

  private generateCustomerIntro(): string {
    if (!this.customer) return '';

    const parts: string[] = [];

    // Basic intro - skip if no meaningful data
    const name = this.customer.name || 'Customer';
    const acres = this.customer.totalAcres || 0;
    const farm = this.customer.farm || '';
    const location = this.customer.location || '';
    const stateProvince = this.customer.stateProvince || '';

    // Build intro with available data
    if (acres > 0 && farm && farm !== 'Unknown Farm') {
      parts.push(`${name} operates ${this.formatQuantity(acres, 'acres')} at ${farm}`);
    } else if (acres > 0) {
      parts.push(`${name} operates ${this.formatQuantity(acres, 'acres')}`);
    } else if (location || stateProvince) {
      const locationStr = location && stateProvince ? `${location}, ${stateProvince}` : (location || stateProvince);
      parts.push(`${name} is located in ${locationStr}`);
    } else {
      // Just use the name if we don't have farm/acres/location data
      parts.push(`${name} is a customer`);
    }

    // Multi-farm operator
    if (this.customer.farmIds && Array.isArray(this.customer.farmIds) && this.customer.farmIds.length > 1) {
      parts.push(`across ${this.customer.farmIds.length} farm locations`);
    }

    // Linked producers info
    const linkedProducerIds = this.customer.linkedProducerIds || [];
    const customersLinkingToMe = this.allCustomers
      .filter(c => c.linkedProducerIds && c.linkedProducerIds.includes(this.customer.id.toString()))
      .map(c => c.id);

    const allLinkedIds = [...new Set([...linkedProducerIds, ...customersLinkingToMe])];

    if (allLinkedIds.length > 0) {
      const linkedProducers = allLinkedIds
        .map(id => this.allCustomers.find(c => c.id === id))
        .filter(c => c != null) as Customer[];

      if (linkedProducers.length === 1) {
        parts.push(`This producer is linked with ${linkedProducers[0].name}, and this summary includes combined activity from both operations`);
      } else if (linkedProducers.length === 2) {
        parts.push(`This producer is linked with ${linkedProducers[0].name} and ${linkedProducers[1].name}, and this summary includes combined activity from all three operations`);
      } else if (linkedProducers.length > 2) {
        const names = linkedProducers.slice(0, -1).map(p => p.name).join(', ');
        const lastName = linkedProducers[linkedProducers.length - 1].name;
        parts.push(`This producer is linked with ${names}, and ${lastName}, and this summary includes combined activity from all ${linkedProducers.length + 1} operations`);
      }
    }

    return parts.join('. ') + '.';
  }

  private generateContractSummary(): string {
    if (!this.contracts || this.contracts.length === 0) return '';

    const now = new Date();
    const activeContracts = this.contracts.filter(c => c && c.status === 'Active');
    const pendingContracts = this.contracts.filter(c => c && c.status === 'Pending');
    const fulfilledContracts = this.contracts.filter(c => c && c.status === 'Fulfilled');
    const signedContracts = this.contracts.filter(c => c && c.signed);
    const unsignedContracts = this.contracts.filter(c => c && !c.signed);

    // Calculate overdue contracts (Active or Pending with delivery end date in the past)
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

    const totalContracts = this.contracts.length;
    if (totalContracts === 0) return '';

    // Calculate totals for active contracts
    const activeVolume = activeContracts.reduce((sum, c) => sum + (c.quantity || 0), 0);
    const activeValue = activeContracts.reduce((sum, c) => sum + (c.totalValue || 0), 0);

    // Build detailed summary
    const parts: string[] = [];

    // Main contract overview
    if (activeContracts.length > 0) {
      parts.push(`They have ${activeContracts.length} active contract${activeContracts.length !== 1 ? 's' : ''} totaling ${this.formatQuantity(activeVolume, 'bushels')} valued at ${this.formatCurrency(activeValue)}`);
    } else {
      parts.push(`They currently have no active contracts`);
    }

    // Status breakdown - build a comprehensive list
    const statusDetails: string[] = [];

    if (pendingContracts.length > 0) {
      statusDetails.push(`${pendingContracts.length} pending`);
    }

    if (fulfilledContracts.length > 0) {
      statusDetails.push(`${fulfilledContracts.length} fulfilled`);
    }

    if (overdueContracts.length > 0) {
      statusDetails.push(`${overdueContracts.length} overdue`);
    }

    if (unsignedContracts.length > 0) {
      statusDetails.push(`${unsignedContracts.length} unsigned`);
    }

    // Add status breakdown to summary
    if (statusDetails.length > 0) {
      if (statusDetails.length === 1) {
        parts.push(`with ${statusDetails[0]}`);
      } else if (statusDetails.length === 2) {
        parts.push(`with ${statusDetails[0]} and ${statusDetails[1]}`);
      } else {
        const last = statusDetails[statusDetails.length - 1];
        const others = statusDetails.slice(0, -1).join(', ');
        parts.push(`with ${others}, and ${last}`);
      }
    }

    return parts.join(' ') + '.';
  }

  private generatePlantingOverview(): string {
    if (!this.plantingIntentions || this.plantingIntentions.length === 0) return '';

    // Group by crop with null safety
    const cropGroups = this.plantingIntentions.reduce((acc, p) => {
      if (!p || !p.crop) return acc; // Skip invalid entries

      const crop = p.crop;
      if (!acc[crop]) {
        acc[crop] = { acres: 0, estimatedYield: 0 };
      }
      acc[crop].acres += p.acres || 0;
      acc[crop].estimatedYield += (p.acres || 0) * (p.estimatedYield || 0);
      return acc;
    }, {} as Record<string, { acres: number; estimatedYield: number }>);

    // Check if we have valid data after filtering
    if (Object.keys(cropGroups).length === 0) return '';

    const totalYield = Object.values(cropGroups).reduce((sum, g) => sum + g.estimatedYield, 0);

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

    return `Their planting plans include ${crops}, expecting to yield approximately ${this.formatQuantity(totalYield, 'bushels')}.`;
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

    return `In storage, they're holding ${this.formatQuantity(totalStored, 'bushels')} that has been stored for an average of ${Math.floor(avgDays)} days.`;
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

    // Build delivery summary parts
    const parts: string[] = [];

    // Recent delivery activity
    if (recentTickets.length > 0) {
      const totalDelivered = recentTickets.reduce((sum, t) => sum + (t.netWeight || 0), 0);
      parts.push(`Recent deliveries total ${this.formatQuantity(totalDelivered, 'lbs')} over the past 30 days (${recentTickets.length} ticket${recentTickets.length !== 1 ? 's' : ''})`);

      // Quality metrics
      const ticketsWithMoisture = recentTickets.filter(t => typeof t.moisture === 'number' && !isNaN(t.moisture) && t.moisture > 0);
      const ticketsWithTestWeight = recentTickets.filter(t => typeof t.testWeight === 'number' && !isNaN(t.testWeight) && t.testWeight > 0);

      if (ticketsWithMoisture.length > 0 && ticketsWithTestWeight.length > 0) {
        const avgMoisture = ticketsWithMoisture.reduce((sum, t) => sum + (t.moisture || 0), 0) / ticketsWithMoisture.length;
        const avgTestWeight = ticketsWithTestWeight.reduce((sum, t) => sum + (t.testWeight || 0), 0) / ticketsWithTestWeight.length;
        parts.push(`averaging ${avgMoisture.toFixed(1)}% moisture and ${avgTestWeight.toFixed(1)} lbs/bu test weight`);
      }

      // 90-day trend if different from 30-day
      if (last90Days.length > recentTickets.length) {
        const total90Days = last90Days.reduce((sum, t) => sum + (t.netWeight || 0), 0);
        parts.push(`with ${last90Days.length} total deliveries over 90 days (${this.formatQuantity(total90Days, 'lbs')})`);
      }
    } else if (last90Days.length > 0) {
      // No recent tickets, but have some in last 90 days
      const total90Days = last90Days.reduce((sum, t) => sum + (t.netWeight || 0), 0);
      parts.push(`They have ${last90Days.length} delivery ticket${last90Days.length !== 1 ? 's' : ''} in the past 90 days totaling ${this.formatQuantity(total90Days, 'lbs')}`);
    } else {
      // No recent activity
      parts.push(`They have ${totalTickets} delivery ticket${totalTickets !== 1 ? 's' : ''} on record, but no recent activity in the past 90 days`);
    }

    return parts.join(', ') + '.';
  }

  private generateEngagementSummary(): string {
    if (!this.notes || this.notes.length === 0) return '';

    // Filter valid notes with dates
    const validNotes = this.notes.filter(n => n && n.createdAt);
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

      const lastDate = new Date(lastNote.createdAt);
      if (isNaN(lastDate.getTime())) return '';

      const daysSince = this.calculateDaysBetween(lastDate, new Date());
      const createdBy = lastNote.createdBy || 'Unknown';

      if (daysSince === 0) {
        return `Our most recent contact was today with ${createdBy}.`;
      } else if (daysSince === 1) {
        return `We last connected yesterday with ${createdBy}.`;
      } else if (daysSince <= 7) {
        return `${createdBy} touched base with them ${Math.abs(daysSince)} days ago.`;
      } else {
        return `Our last interaction was ${Math.abs(daysSince)} days ago with ${createdBy}.`;
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
      alerts.push(`Important: ${overdueContracts.length} contract${overdueContracts.length !== 1 ? 's have' : ' has'} passed ${overdueContracts.length !== 1 ? 'their' : 'its'} delivery deadline`);
    }

    // Check for unsigned contracts
    const unsignedContracts = this.contracts.filter(c => c && c.signed === false);
    if (unsignedContracts.length > 0) {
      const prefix = alerts.length > 0 ? 'additionally, ' : 'Note: ';
      alerts.push(`${prefix}${unsignedContracts.length} contract${unsignedContracts.length !== 1 ? 's are' : ' is'} still awaiting signature`);
    }

    // Upcoming delivery deadline with validation
    const upcomingDeliveries = this.contracts
      .filter(c => {
        if (!c || !c.deliveryEnd || c.status !== 'Active') return false;
        try {
          const endDate = new Date(c.deliveryEnd);
          return !isNaN(endDate.getTime()) && endDate >= now;
        } catch {
          return false;
        }
      })
      .sort((a, b) => {
        const dateA = new Date(a.deliveryEnd).getTime();
        const dateB = new Date(b.deliveryEnd).getTime();
        return dateA - dateB;
      });

    if (upcomingDeliveries.length > 0 && alerts.length === 0) {
      const nextContract = upcomingDeliveries[0];
      try {
        const daysRemaining = this.calculateDaysBetween(now, new Date(nextContract.deliveryEnd));
        if (daysRemaining <= 30 && daysRemaining >= 0) {
          const crop = nextContract.commodityDescription || nextContract.commodityCode || 'grain';
          if (daysRemaining <= 7) {
            alerts.push(`Upcoming: their ${crop} contract delivery window closes in just ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`);
          } else {
            alerts.push(`The next ${crop} delivery deadline is coming up in ${daysRemaining} days`);
          }
        }
      } catch {
        // Skip if date calculation fails
      }
    }

    return alerts.length > 0 ? alerts.join(', ') + '.' : '';
  }

  private generateUpcomingActions(): string {
    const sentences: string[] = [];
    const now = new Date();

    // Upcoming deliveries
    const upcomingDeliveries = this.contracts
      .filter(c => c.status === 'Active' && new Date(c.deliveryEnd) >= now)
      .sort((a, b) => new Date(a.deliveryEnd).getTime() - new Date(b.deliveryEnd).getTime());

    if (upcomingDeliveries.length > 0) {
      const nextContract = upcomingDeliveries[0];
      const daysRemaining = this.calculateDaysBetween(now, new Date(nextContract.deliveryEnd));
      const cropName = nextContract.commodityDescription || nextContract.commodityCode || 'grain';
      sentences.push(`Next delivery deadline: ${cropName} contract ends in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`);
    }

    // Overdue deliveries
    const overdueContracts = this.contracts.filter(c =>
      (c.status === 'Active' || c.status === 'Pending') &&
      new Date(c.deliveryEnd) < now
    );

    if (overdueContracts.length > 0) {
      sentences.push(`${overdueContracts.length} contract${overdueContracts.length !== 1 ? 's are' : ' is'} past delivery deadline and require${overdueContracts.length === 1 ? 's' : ''} attention`);
    }

    // Seasonal recommendations
    const season = this.getCurrentSeason();
    const seasonalMessage = this.getSeasonalMessage(season);
    if (seasonalMessage) {
      sentences.push(seasonalMessage);
    }

    return sentences.length > 0 ? sentences.join('. ') + '.' : '';
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

  private calculateStorageCost(grain: StoredGrain): number {
    const startDate = new Date(grain.storageStartDate);
    const now = new Date();
    const monthsStored = (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
    return grain.quantity * grain.storageRate * monthsStored;
  }

  private getCurrentSeason(): Season {
    const month = new Date().getMonth(); // 0-11
    if (month >= 2 && month <= 4) return 'spring';  // Mar-May
    if (month >= 5 && month <= 7) return 'summer';  // Jun-Aug
    if (month >= 8 && month <= 10) return 'fall';   // Sep-Nov
    return 'winter'; // Dec-Feb
  }

  private getSeasonalMessage(season: Season): string {
    switch (season) {
      case 'spring':
        return 'Spring planting season is underway - ideal time to finalize crop plans and secure contracts';
      case 'summer':
        return 'Growing season in progress - monitor crop health and prepare storage facilities';
      case 'fall':
        return 'Harvest season - focus on delivery schedules, quality assessments, and storage management';
      case 'winter':
        return 'Planning season - review stored grain positions and establish marketing strategy for next year';
    }
  }
}
