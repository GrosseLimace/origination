import { Component, Input, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';

@Component({
  selector: 'app-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SelectComponent),
      multi: true
    }
  ],
  template: `
    <select
      [disabled]="disabled"
      [class]="selectClass"
      [(ngModel)]="value"
      (ngModelChange)="onChange($event)"
      (blur)="onTouched()"
    >
      @if (placeholder) {
        <option value="" disabled>{{ placeholder }}</option>
      }
      <ng-content></ng-content>
    </select>
  `
})
export class SelectComponent implements ControlValueAccessor {
  @Input() placeholder = '';
  @Input() disabled = false;
  @Input() class = '';

  value = '';
  onChange: (value: string) => void = () => {};
  onTouched: () => void = () => {};

  get selectClass(): string {
    return `flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50 ${this.class}`;
  }

  writeValue(value: string): void {
    this.value = value || '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }
}
