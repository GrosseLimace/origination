import { Component, Input, Output, EventEmitter, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * TabsComponent provides a tabbed interface for organizing content.
 * Uses Angular signals for reactive tab state management.
 */
@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="w-full">
      <div class="border-b border-gray-200 dark:border-gray-700">
        <nav class="flex space-x-4 overflow-x-auto" aria-label="Tabs">
          @for (tab of tabs; track tab.id) {
            <button
              (click)="selectTab(tab.id)"
              [class]="getTabClass(tab.id)"
              [attr.aria-current]="activeTab() === tab.id ? 'page' : null"
            >
              {{ tab.label }}
            </button>
          }
        </nav>
      </div>
      <div class="mt-4">
        <ng-content></ng-content>
      </div>
    </div>
  `
})
export class TabsComponent implements OnInit {
  @Input() tabs: { id: string; label: string }[] = [];
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
    const base = 'px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors';
    if (this.activeTab() === tabId) {
      return `${base} border-b-2 border-green-600 text-green-600 dark:text-green-400 dark:border-green-400`;
    }
    return `${base} text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300`;
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
