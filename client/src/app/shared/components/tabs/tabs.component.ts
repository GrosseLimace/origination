import { Component, input, output, signal, computed } from '@angular/core';

@Component({
  selector: 'app-tabs',
  standalone: true,
  template: `
    <div class="w-full">
      <div class="scoular-tabs mb-6">
        @for (tab of tabs(); track tab.id) {
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
      <div>
        <ng-content></ng-content>
      </div>
    </div>
  `
})
export class TabsComponent {
  public tabs = input<{ id: string; label: string; count?: number }[]>([]);
  public defaultTab = input<string>('');
  public tabChange = output<string>();

  public activeTab = computed(() => this.defaultTab() || (this.tabs().length > 0 ? this.tabs()[0].id : ''));
  private _activeTab = signal<string>('');

  public selectTab(tabId: string): void {
    this._activeTab.set(tabId);
    this.tabChange.emit(tabId);
  }

  public getTabClass(tabId: string): string {
    const isActive = this._activeTab() ? this._activeTab() === tabId : this.activeTab() === tabId;
    return isActive ? 'scoular-tab active' : 'scoular-tab';
  }
}

@Component({
  selector: 'app-tab-content',
  standalone: true,
  template: `
    @if (isActive()) {
      <ng-content></ng-content>
    }
  `
})
export class TabContentComponent {
  public tabId = input<string>('');
  public activeTab = input<string>('');

  public isActive = computed(() => this.tabId() === this.activeTab());
}
