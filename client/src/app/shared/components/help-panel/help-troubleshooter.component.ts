import { ChangeDetectionStrategy, Component, Injector, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { Customer } from '@models';
import { ApiService } from '@core/services/api.service';
import { AppStateService } from '@core/services/app-state.service';
import { HelpPanelService } from '@core/services/help-panel.service';
import { UsageTrackingService } from '@core/services/usage-tracking.service';
import { UserTradeUnitsService } from '@core/services/user-trade-units.service';
import { HelpIconComponent } from '@shared/components/help-icon/help-icon.component';
import { revealAfterRender } from '@shared/utils/help-reveal';

/** The troubleshooters help-faq.json may start. help-faq.drift.spec.ts holds the content to this list. */
export const HELP_TROUBLESHOOTERS = ['missing-producer'] as const;

/** Where a "where is this producer?" check ended up. */
type Result =
  | { kind: 'in-selection'; customer: Customer; tradeUnit: string }
  | { kind: 'other-trade-unit'; customer: Customer; tradeUnit: string; canSwitch: boolean }
  | { kind: 'not-added'; name: string }
  | { kind: 'not-found'; name: string }
  | { kind: 'error' };

const MIN_NAME = 3;

/**
 * "A producer isn't showing up": the troubleshooter from the approved design. Step 1 is answered by
 * the app (what's selected), step 2 asks for a name, step 3 looks the producer up the same two ways
 * the Producers page does — our producer table across every trade unit, then the customer master —
 * and says which case applies, with the button that fixes it.
 *
 * Producer names found here are shown to the user and go nowhere else: telemetry records the outcome
 * code only. Trade units are a convenience filter, not an access boundary (SECURITY-MODEL.md), so
 * looking outside the selection reveals nothing the search box wouldn't.
 */
@Component({
  selector: 'app-help-troubleshooter',
  standalone: true,
  imports: [HelpIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './help-troubleshooter.component.html'
})
export class HelpTroubleshooterComponent {
  private readonly api = inject(ApiService);
  private readonly appState = inject(AppStateService);
  private readonly panel = inject(HelpPanelService);
  private readonly router = inject(Router);
  private readonly usageTracking = inject(UsageTrackingService);
  private readonly userTradeUnits = inject(UserTradeUnitsService);
  private readonly injector = inject(Injector);

  readonly tree = input.required<string>();
  readonly index = input.required<number>();

  readonly name = signal('');
  readonly checking = signal(false);
  readonly result = signal<Result | null>(null);
  readonly switched = signal(false);
  readonly tooShort = signal(false);

  readonly inputId = computed(() => `help-trouble-${this.index()}`);

  /** Step 1, answered from app state. */
  readonly selection = computed(() => {
    if (this.appState.noTradeUnitAssignments()) return { kind: 'none-assigned' as const };
    if (this.appState.allProducersMode()) return { kind: 'all-producers' as const };
    const codes = [...this.appState.inScopeTradeUnitCodes()];
    if (!this.appState.userGroupsLoaded() || codes.length === 0) return { kind: 'unknown' as const };
    return { kind: 'selected' as const, label: codes.map(c => this.describe(c)).join(', ') };
  });

  onInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
    this.tooShort.set(false);
  }

  async check(): Promise<void> {
    const name = this.name().trim();
    if (name.length < MIN_NAME) {
      this.tooShort.set(true);
      return;
    }

    this.checking.set(true);
    this.switched.set(false);
    try {
      this.result.set(await this.lookUp(name));
    } catch {
      this.result.set({ kind: 'error' });
    } finally {
      this.checking.set(false);
    }
    this.usageTracking.trackHelpTroubleshoot(this.result()!.kind);
    // The result appears below the name box, often below the fold of the panel.
    revealAfterRender(this.injector, () => document.getElementById(this.inputId() + '-result'));
  }

  /** Selects the producer's trade unit the way the selector would: its group, then the unit. */
  switchTo(tradeUnit: string): void {
    const group = this.appState.userGroups().find(g => g.tradeUnitCodes.some(c => c.trim() === tradeUnit));
    // Select the code exactly as the group lists it: the selector compares raw codes, so a trimmed
    // copy of a padded code would show as unselected and be pruned.
    const code = group?.tradeUnitCodes.find(c => c.trim() === tradeUnit) ?? tradeUnit;
    this.appState.setAllProducersMode(false);
    if (group) this.appState.setSelectedGroupNames([group.groupName]);
    this.appState.setTradeUnits([code]);
    this.switched.set(true);
  }

  openProducer(customer: Customer): void {
    void this.router.navigate(['/'], { queryParams: { customerId: customer.id } });
    if (!this.panel.desktop()) this.panel.close();
  }

  /**
   * Onboarding happens on the Producers page itself (All Producers → search → Not added → Edit), so
   * this puts the page into All Producers mode — exactly what choosing it in the selector does — and
   * shows the user the search box.
   */
  openAndAdd(): void {
    this.appState.setAllProducersMode(true);
    this.appState.setSelectedGroupNames([]);
    this.appState.setTradeUnits([]);
    this.panel.showOnScreen('producer-search');
  }

  /** Step 1's "Show me the selector": outlines the trade-unit selector on the Producers page. */
  showSelector(): void {
    this.panel.showOnScreen('trade-unit-selector');
  }

  openPreferences(): void {
    this.userTradeUnits.openPreferences();
  }

  escalate(): void {
    this.panel.escalate();
  }

  describe(code: string): string {
    const description = this.appState.tradeUnitDescriptions().get(code);
    return description ? `${code} · ${description}` : code;
  }

  private async lookUp(name: string): Promise<Result> {
    // No trade units passed: our producer table across every trade unit.
    const found = await firstValueFrom(this.api.searchCustomers(name));
    if (found.length > 0) {
      const customer = found[0];
      const units = (customer.activeTradeUnits ?? []).map(u => u.trim());
      const selected = new Set(this.appState.allProducersMode() ? [] : this.appState.inScopeTradeUnitCodes());
      const inSelection = units.find(u => selected.has(u));
      if (inSelection) return { kind: 'in-selection', customer, tradeUnit: inSelection };

      const mine = new Set(this.appState.userGroups().flatMap(g => g.tradeUnitCodes.map(c => c.trim())));
      const switchable = units.find(u => mine.has(u));
      return { kind: 'other-trade-unit', customer, tradeUnit: switchable ?? units[0] ?? '', canSwitch: switchable !== undefined };
    }

    // Not in our table: the customer master, as the Producers page's onboarding fallback does.
    const master = await firstValueFrom(this.api.searchOdsCustomers(name));
    return master.length > 0 ? { kind: 'not-added', name: master[0].name } : { kind: 'not-found', name };
  }
}
