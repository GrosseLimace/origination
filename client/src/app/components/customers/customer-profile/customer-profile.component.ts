import { Component, Input, Output, EventEmitter, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent, CardHeaderComponent, CardTitleComponent, CardContentComponent } from '../../ui/card/card.component';
import { BadgeComponent } from '../../ui/badge/badge.component';
import { ButtonComponent } from '../../ui/button/button.component';
import { TabsComponent, TabContentComponent } from '../../ui/tabs/tabs.component';
import { ContractsTableComponent } from '../contracts-table/contracts-table.component';
import { TicketsTableComponent } from '../tickets-table/tickets-table.component';
import { PlantingIntentionsTableComponent } from '../planting-intentions-table/planting-intentions-table.component';
import { StoredGrainTableComponent } from '../stored-grain-table/stored-grain-table.component';
import { CustomerNotesComponent } from '../customer-notes/customer-notes.component';
import { Customer, Farm, Contract, Ticket, PlantingIntention, StoredGrain, Note } from '../../../models';

@Component({
  selector: 'app-customer-profile',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    CardHeaderComponent,
    CardTitleComponent,
    CardContentComponent,
    BadgeComponent,
    ButtonComponent,
    TabsComponent,
    TabContentComponent,
    ContractsTableComponent,
    TicketsTableComponent,
    PlantingIntentionsTableComponent,
    StoredGrainTableComponent,
    CustomerNotesComponent
  ],
  template: `
    <div class="space-y-4">
      <!-- Customer Header -->
      <app-card>
        <app-card-content class="p-6">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-4">
              <div class="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                <span class="text-2xl font-semibold text-green-700 dark:text-green-300">
                  {{ getInitials(customer.name) }}
                </span>
              </div>
              <div>
                <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100">{{ customer.name }}</h2>
                <p class="text-gray-500 dark:text-gray-400">{{ customer.farm }}</p>
                <div class="flex items-center gap-2 mt-1">
                  <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                  </svg>
                  <span class="text-sm text-gray-500 dark:text-gray-400">{{ customer.location }}</span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              @if (customer.eSignEnabled) {
                <app-badge variant="success">e-Sign Enabled</app-badge>
              }
              <app-button variant="outline" size="sm" (click)="onEdit.emit()">
                <svg class="h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                </svg>
                Edit
              </app-button>
            </div>
          </div>

          <!-- Contact Info -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
            <div>
              <p class="text-sm text-gray-500 dark:text-gray-400">Phone</p>
              <p class="font-medium text-gray-900 dark:text-gray-100">{{ customer.phone }}</p>
            </div>
            <div>
              <p class="text-sm text-gray-500 dark:text-gray-400">Email</p>
              <p class="font-medium text-gray-900 dark:text-gray-100">{{ customer.email }}</p>
            </div>
            <div>
              <p class="text-sm text-gray-500 dark:text-gray-400">Total Acres</p>
              <p class="font-medium text-gray-900 dark:text-gray-100">{{ customer.totalAcres | number }}</p>
            </div>
            <div>
              <p class="text-sm text-gray-500 dark:text-gray-400">Farms</p>
              <p class="font-medium text-gray-900 dark:text-gray-100">{{ farms.length }}</p>
            </div>
          </div>
        </app-card-content>
      </app-card>

      <!-- Tabs Section -->
      <app-card>
        <app-card-content class="p-6">
          <app-tabs [tabs]="tabs" [defaultTab]="'contracts'" (tabChange)="activeTab.set($event)">
            <app-tab-content tabId="contracts" [activeTab]="activeTab()">
              <app-contracts-table [contracts]="contracts" [customer]="customer"></app-contracts-table>
            </app-tab-content>

            <app-tab-content tabId="tickets" [activeTab]="activeTab()">
              <app-tickets-table [tickets]="tickets" [customer]="customer"></app-tickets-table>
            </app-tab-content>

            <app-tab-content tabId="planting" [activeTab]="activeTab()">
              <app-planting-intentions-table
                [plantingIntentions]="plantingIntentions"
                [customer]="customer"
                (add)="onAddPlanting.emit()"
                (edit)="onEditPlanting.emit($event)">
              </app-planting-intentions-table>
            </app-tab-content>

            <app-tab-content tabId="storage" [activeTab]="activeTab()">
              <app-stored-grain-table [storedGrain]="storedGrain" [customer]="customer"></app-stored-grain-table>
            </app-tab-content>

            <app-tab-content tabId="notes" [activeTab]="activeTab()">
              <app-customer-notes
                [notes]="notes"
                [customer]="customer"
                (addNote)="onAddNote.emit($event)"
                (togglePin)="onTogglePin.emit($event)">
              </app-customer-notes>
            </app-tab-content>
          </app-tabs>
        </app-card-content>
      </app-card>
    </div>
  `
})
export class CustomerProfileComponent {
  @Input() customer!: Customer;
  @Input() farms: Farm[] = [];
  @Input() contracts: Contract[] = [];
  @Input() tickets: Ticket[] = [];
  @Input() plantingIntentions: PlantingIntention[] = [];
  @Input() storedGrain: StoredGrain[] = [];
  @Input() notes: Note[] = [];

  @Output() onEdit = new EventEmitter<void>();
  @Output() onAddPlanting = new EventEmitter<void>();
  @Output() onEditPlanting = new EventEmitter<PlantingIntention>();
  @Output() onAddNote = new EventEmitter<string>();
  @Output() onTogglePin = new EventEmitter<Note>();

  activeTab = signal('contracts');

  tabs = [
    { id: 'contracts', label: 'Contracts' },
    { id: 'tickets', label: 'Tickets' },
    { id: 'planting', label: 'Planting Intentions' },
    { id: 'storage', label: 'Stored Grain' },
    { id: 'notes', label: 'Notes' }
  ];

  getInitials(name: string): string {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
}
