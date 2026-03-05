import { Component, Input, Output, EventEmitter, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * TabsComponent provides a pill-style tabbed interface for organizing content.
 * Uses Angular signals for reactive tab state management.
 */
@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="w-full">
      <!-- Pill-style tab navigation -->
      <div class="w-full bg-gray-100 dark:bg-gray-800 rounded-full p-1 mb-6">
        <div class="flex">
          @for (tab of tabs; track tab.id) {
            <button
              type="button"
              (click)="selectTab(tab.id)"
              [class]="getTabClass(tab.id)"
              [attr.aria-current]="activeTab() === tab.id ? 'page' : null"
            >
              {{ tab.label }}
              @if (tab.count !== undefined) {
                <span class="ml-1">({{ tab.count }})</span>
              }
            </button>
          }
        </div>
      </div>
      <div>
        <ng-content></ng-content>
      </div>
    </div>
  `
})
export class TabsComponent implements OnInit {
  @Input() tabs: { id: string; label: string; count?: number }[] = [];
  @Input() defaultTab = '';
  @Output() tabChange = new EventEmitter<string>();

  activeTab = signal('');

  ngOnInit() {
    this.activeTab.set(this.defaultTab || (this.tabs.length > 0 ? this.tabs[0].id : ''));
  }

  selectTab(tabId: string) {
    this.activeTab.set(tabId);
    this.tabChange.emit(tabId);
  }

  getTabClass(tabId: string): string {
    const baseClass = 'px-4 py-2 text-sm font-medium rounded-full transition-all duration-200 border-0 outline-none flex-1 text-center';
    if (this.activeTab() === tabId) {
      return `${baseClass} bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm`;
    }
    return `${baseClass} bg-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white`;
  }
}

@Component({
  selector: 'app-tab-content',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (isActive) {
      <ng-content></ng-content>
    }
  `
})
export class TabContentComponent {
  @Input() tabId = '';
  @Input() activeTab = '';

  get isActive(): boolean {
    return this.tabId === this.activeTab;
  }
}
