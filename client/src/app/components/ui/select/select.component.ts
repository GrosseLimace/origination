import { Component, input, signal, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';

@Component({
  selector: 'app-select',
  standalone: true,
  imports: [FormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SelectComponent),
      multi: true
    }
  ],
  template: `
    <select
      [disabled]="disabled()"
      [class]="selectClass"
      [(ngModel)]="value"
      (ngModelChange)="onChange($event)"
      (blur)="onTouched()"
    >
      @if (placeholder()) {
        <option value="" disabled>{{ placeholder() }}</option>
      }
      <ng-content></ng-content>
    </select>
  `
})
export class SelectComponent implements ControlValueAccessor {
  public placeholder = input<string>('');
  public class = input<string>('');

  public disabled = signal<boolean>(false);

  public value = '';
  public onChange: (value: string) => void = () => {};
  public onTouched: () => void = () => {};

  public get selectClass(): string {
    return ['scoular-form-select h-10', this.class()].filter(Boolean).join(' ');
  }

  public writeValue(value: string): void {
    this.value = value || '';
  }

  public registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  public registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  public setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }
}
