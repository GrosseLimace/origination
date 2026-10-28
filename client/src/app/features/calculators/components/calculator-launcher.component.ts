import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, input, signal } from '@angular/core';

import { CALCULATOR_TYPES, CalculatorType } from '../models/calculator.model';
import { CalculatorWidgetComponent } from './calculator-widget.component';
import { HelpPanelStateService } from '@core/services/help-panel-state.service';

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
  // The template reads only inputs and signals. The document click/Escape listeners write
  // signals too, so they re-render the picker without relying on the listener marking the view.
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalculatorLauncherComponent {
  /** Selected producer's name — prefilled into the calculator's Farm Name field. */
  readonly producerName = input<string>('');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Public: the template steps the launcher left while the Help panel is open. */
  readonly helpPanel = inject(HelpPanelStateService);

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
  }

  closeWidget(): void {
    this.activeType.set(null);
  }

  titleFor(type: CalculatorType): string {
    const label = this.types.find(t => t.type === type)?.label ?? 'Calculator';
    return `${label} Calculator`;
  }
}
