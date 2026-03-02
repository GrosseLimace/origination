import { Component, Input, forwardRef, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';

@Component({
  selector: 'app-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputComponent),
      multi: true
    }
  ],
  template: `
    <input
      #inputElement
      [type]="type"
      [placeholder]="placeholder"
      [disabled]="disabled"
      [class]="inputClass"
      [attr.inputmode]="inputmode || null"
      [(ngModel)]="value"
      (ngModelChange)="onChange($event)"
      (blur)="onTouched()"
      (click)="onInputClick()"
    />
  `
})
export class InputComponent implements ControlValueAccessor {
  @ViewChild('inputElement') inputElement!: ElementRef<HTMLInputElement>;

  @Input() type = 'text';
  @Input() inputmode = '';
  @Input() placeholder = '';
  @Input() disabled = false;
  @Input() class = '';

  value = '';
  onChange: (value: string) => void = () => {};
  onTouched: () => void = () => {};

  onInputClick(): void {
    if (this.type === 'date' && this.inputElement?.nativeElement?.showPicker) {
      try {
        this.inputElement.nativeElement.showPicker();
      } catch {
        // showPicker() may throw if already open or not supported
      }
    }
  }

  get inputClass(): string {
    const dateClass = this.type === 'date' ? 'dark:[color-scheme:dark]' : '';
    return `flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50 ${dateClass} ${this.class}`;
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
