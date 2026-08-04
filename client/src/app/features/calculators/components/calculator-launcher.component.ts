import { Component, ElementRef, HostListener, inject, input, signal } from '@angular/core';

import { UsageTrackingService } from '@core/services/usage-tracking.service';

import { CALCULATOR_TYPES, CalculatorType } from '../models/calculator.model';
import { CalculatorWidgetComponent } from './calculator-widget.component';

/** Usage sub-feature code per calculator. The calculators are browser-only — they call no API — so
 *  these click events are the only trace they leave in usage reporting. */
const OPEN_SUB_FEATURE: Record<CalculatorType, string> = {
  profitability: 'profitability-opened',
  check: 'check-opened',
  cancelRoll: 'cancel-roll-opened',
};

/**
 * Floating launcher for the originator calculators. Renders a fixed FAB on the customer
 * home page; clicking it opens a type picker, and selecting a type opens the movable
 * calculator widget for it. Included once on the home page, gated by the feature flag.
 */
@Component({
  selector: 'app-calculator-launcher',
  standalone: true,
  imports: [CalculatorWidgetComponent],
  templateUrl: './calculator-launcher.component.html',
})
export class CalculatorLauncherComponent {
  /** Selected producer's name — prefilled into the calculator's Farm Name field. */
  readonly producerName = input<string>('');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly usageTracking = inject(UsageTrackingService);

  readonly types = CALCULATOR_TYPES;
  readonly pickerOpen = signal(false);
  readonly activeType = signal<CalculatorType | null>(null);

  togglePicker(): void {
    this.pickerOpen.update(v => !v);
  }

  /** Close the type picker when clicking anywhere outside the launcher (FAB + popover). */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.pickerOpen() && !this.host.nativeElement.contains(event.target as Node)) {
      this.pickerOpen.set(false);
    }
  }

  /** Escape also dismisses the open picker. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.pickerOpen.set(false);
  }

  select(type: CalculatorType): void {
    this.activeType.set(type);
    this.pickerOpen.set(false);
    this.usageTracking.postClickEvent('interaction', 'calculators', OPEN_SUB_FEATURE[type]);
  }

  closeWidget(): void {
    this.activeType.set(null);
  }

  titleFor(type: CalculatorType): string {
    const label = this.types.find(t => t.type === type)?.label ?? 'Calculator';
    return `${label} Calculator`;
  }
}
