import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { SessionStore } from '../../core/state/session.store';
import { SpinnerComponent } from '../../core/ui/spinner.component';

const OTHER_GROUP = '__other__';

/**
 * First screen after sign-in: pick a group (dropdown), then tick the trade units in it, then Next.
 * Trade units that belong to no group are offered under "Other trade units" so nothing entitled is hidden.
 */
@Component({
  selector: 'mob-trade-units-page',
  imports: [SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-xl font-bold text-gray-900 dark:text-gray-100">Where are you working today?</h1>
    <p class="text-sm text-gray-500 dark:text-gray-400 mb-3">Choose a group, then the trade units. Producers, notes and lists are scoped to your choice.</p>

    @if (session.loading() && session.tradeUnits().length === 0) {
      <mob-spinner label="Loading your trade units…" />
    } @else if (session.tradeUnits().length === 0) {
      <p class="text-sm text-gray-500 dark:text-gray-400">You have no trade units assigned. Set them in Trade Unit Preferences on the desktop.</p>
    } @else {
      <label class="block mb-3">
        <span class="mob-label">Group</span>
        <select class="mt-1 w-full h-12 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 text-base"
                [value]="groupValue()" (change)="onGroupChange($any($event.target).value)" aria-label="Group">
          <option value="" disabled>Select a group…</option>
          @for (g of session.groups(); track g.name) {
            <option [value]="g.name">{{ g.name }} ({{ g.tradeUnitCodes.length }})</option>
          }
          @if (ungrouped().length > 0) {
            <option [value]="otherGroup">Other trade units ({{ ungrouped().length }})</option>
          }
        </select>
      </label>

      @if (codesForGroup().length > 0) {
        <section class="mob-card p-0 overflow-hidden">
          <label class="flex items-center gap-3 px-4 min-h-12 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700 cursor-pointer">
            <input type="checkbox" class="h-5 w-5 accent-scoular-green-accessible"
                   [checked]="allSelected()" [indeterminate]="someSelected()"
                   (change)="toggleAll()" aria-label="Select all trade units in this group">
            <span class="font-semibold text-gray-900 dark:text-gray-100">Select all</span>
            <span class="ml-auto text-xs text-gray-500 dark:text-gray-400">{{ selectedCount() }} of {{ codesForGroup().length }}</span>
          </label>
          <ul role="list">
            @for (code of codesForGroup(); track code) {
              <li>
                <label class="flex items-center gap-3 px-4 min-h-12 border-b last:border-b-0 border-gray-100 dark:border-gray-700 cursor-pointer active:bg-gray-50 dark:active:bg-gray-700">
                  <input type="checkbox" class="h-5 w-5 accent-scoular-green-accessible" [checked]="session.isSelected(code)" (change)="session.toggleTradeUnit(code)">
                  <span class="text-gray-900 dark:text-gray-100">{{ session.tradeUnitName(code) }}</span>
                  <span class="ml-auto text-xs text-gray-400 dark:text-gray-500">{{ code }}</span>
                </label>
              </li>
            }
          </ul>
        </section>
      } @else if (groupValue()) {
        <p class="text-sm text-gray-500 dark:text-gray-400">No trade units in this group.</p>
      }

      <div class="sticky bottom-0 -mx-4 px-4 pt-3 pb-3 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-200 dark:border-gray-700 mt-4"
           [style.padding-bottom]="'calc(0.75rem + var(--mob-safe-bottom))'">
        <button type="button" class="mob-tap w-full h-12 bg-scoular-green-accessible text-white font-semibold text-base disabled:opacity-50"
                [disabled]="!session.hasSelection()" (click)="next()">
          Next{{ session.hasSelection() ? ' · ' + session.selectedTradeUnits().length + ' selected' : '' }}
        </button>
      </div>
    }
  `,
})
export class TradeUnitsPage {
  protected readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  protected readonly otherGroup = OTHER_GROUP;

  /** Entitled trade units that appear in no group. */
  protected readonly ungrouped = computed(() => {
    const grouped = new Set(this.session.groups().flatMap((g) => g.tradeUnitCodes));
    return this.session.tradeUnits().filter((t) => !grouped.has(t.code));
  });

  /** Dropdown value: the chosen group's name, the "other" sentinel, or '' when nothing is chosen yet. */
  protected readonly groupValue = computed(() => {
    const chosen = this.session.selectedGroup();
    if (chosen) return chosen.name;
    // A user with no groups at all goes straight to their flat list.
    if (this.session.groups().length === 0 && this.ungrouped().length > 0) return OTHER_GROUP;
    return this.otherChosen ? OTHER_GROUP : '';
  });

  protected readonly codesForGroup = computed(() => {
    if (this.groupValue() === OTHER_GROUP) return this.ungrouped().map((t) => t.code);
    return this.session.selectedGroup()?.tradeUnitCodes ?? [];
  });

  protected readonly selectedCount = computed(() => this.codesForGroup().filter((c) => this.session.isSelected(c)).length);
  protected readonly allSelected = computed(() => this.codesForGroup().length > 0 && this.selectedCount() === this.codesForGroup().length);
  protected readonly someSelected = computed(() => this.selectedCount() > 0 && !this.allSelected());

  private otherChosen = false;

  constructor() {
    void this.session.ensureLoaded();
  }

  protected onGroupChange(value: string): void {
    this.otherChosen = value === OTHER_GROUP;
    this.session.selectGroup(this.otherChosen ? null : value || null);
  }

  protected toggleAll(): void {
    const codes = this.codesForGroup();
    const rest = this.session.selectedTradeUnits().filter((c) => !codes.includes(c));
    this.session.setSelection(this.allSelected() ? rest : [...rest, ...codes]);
  }

  protected next(): void {
    void this.router.navigateByUrl('/producers');
  }
}
