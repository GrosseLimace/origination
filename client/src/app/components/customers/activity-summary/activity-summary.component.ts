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
          <h3 class="font-semibold text-lg text-green-600 dark:text-green-400">Summary</h3>
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

  summaryText = '';

  ngOnChanges(changes: SimpleChanges): void {
    this.summaryText = this.generateSummaryParagraph();
  }

  private generateSummaryParagraph(): string {
    const sentences: string[] = [];

    // Customer intro
    if (this.customer) {
      sentences.push(`${this.customer.name} operates ${this.customer.totalAcres.toLocaleString()} acres at ${this.customer.farm}.`);
    }

    // Market share insight
    const totalProjected = this.plantingIntentions.reduce((sum, p) => sum + (p.acres * p.estimatedYield), 0);
    const totalContracted = this.contracts
      .filter(c => c.status === 'Active' || c.status === 'Pending')
      .reduce((sum, c) => sum + c.quantity, 0);

    if (totalProjected > 0) {
      const marketShare = (totalContracted / totalProjected) * 100;
      sentences.push(`Currently capturing ${Math.floor(marketShare)}% of projected ${totalProjected.toLocaleString()} bushel yield.`);
    }

    // Contract summary
    if (this.contracts.length > 0) {
      const activeContracts = this.contracts.filter(c => c.status === 'Active').length;
      sentences.push(`Has ${this.contracts.length} total contracts (${activeContracts} active).`);
    }

    // Planting overview
    if (this.plantingIntentions.length > 0) {
      const cropGroups = this.plantingIntentions.reduce((acc, p) => {
        acc[p.crop] = (acc[p.crop] || 0) + p.acres;
        return acc;
      }, {} as Record<string, number>);

      const crops = Object.entries(cropGroups)
        .map(([crop, acres]) => `${acres.toLocaleString()} acres of ${crop}`)
        .join(', ');
      sentences.push(`Planning to plant ${crops} this season.`);
    }

    // Storage situation
    if (this.storedGrain.length > 0) {
      const totalStored = this.storedGrain.reduce((sum, s) => sum + s.quantity, 0);
      const avgDays = this.storedGrain.reduce((sum, s) => {
        const days = Math.floor((Date.now() - new Date(s.storageStartDate).getTime()) / (1000 * 60 * 60 * 24));
        return sum + days;
      }, 0) / this.storedGrain.length;
      sentences.push(`Currently storing ${totalStored.toLocaleString()} bushels (avg ${Math.floor(avgDays)} days in storage).`);
    }

    // Recent contact
    if (this.notes.length > 0) {
      const sorted = [...this.notes].sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const lastNote = sorted[0];
      const daysSince = Math.floor((Date.now() - new Date(lastNote.createdAt).getTime()) / (1000 * 60 * 60 * 24));

      if (daysSince === 0) {
        sentences.push(`Last contacted today by ${lastNote.createdBy}.`);
      } else if (daysSince === 1) {
        sentences.push(`Last contacted yesterday by ${lastNote.createdBy}.`);
      } else {
        sentences.push(`Last contacted ${daysSince} days ago by ${lastNote.createdBy}.`);
      }
    } else {
      sentences.push('No contact history recorded yet.');
    }

    // Delivery activity
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentTickets = this.tickets.filter(t => new Date(t.date) >= thirtyDaysAgo);
    if (recentTickets.length > 0) {
      const totalDelivered = recentTickets.reduce((sum, t) => sum + t.netWeight, 0);
      sentences.push(`Delivered ${totalDelivered.toLocaleString()} lbs in the last 30 days across ${recentTickets.length} tickets.`);
    }

    // Upcoming actions
    const now = new Date();
    const upcomingDeliveries = this.contracts
      .filter(c => c.status === 'Active' && new Date(c.deliveryEnd) >= now)
      .sort((a, b) => new Date(a.deliveryEnd).getTime() - new Date(b.deliveryEnd).getTime());

    if (upcomingDeliveries.length > 0) {
      const nextContract = upcomingDeliveries[0];
      const daysRemaining = Math.floor((new Date(nextContract.deliveryEnd).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      sentences.push(`Next delivery deadline: ${nextContract.commodityDescription || nextContract.commodityCode} contract ends in ${daysRemaining} days.`);
    }

    return sentences.length > 0 ? sentences.join(' ') : 'No activity data available for this customer.';
  }
}
