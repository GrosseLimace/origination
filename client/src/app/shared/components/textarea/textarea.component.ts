import { Component, input, signal, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';

@Component({
  selector: 'app-textarea',
  standalone: true,
  imports: [FormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TextareaComponent),
      multi: true
    }
  ],
  template: `
    <textarea
      [placeholder]="placeholder()"
      [disabled]="disabled()"
      [rows]="rows()"
      [class]="textareaClass"
      [(ngModel)]="value"
      (ngModelChange)="onChange($event)"
      (blur)="onTouched()"
    ></textarea>
  `
})
export class TextareaComponent implements ControlValueAccessor {
  public placeholder = input<string>('');
  public rows = input<number>(3);
  public class = input<string>('');

  public disabled = signal<boolean>(false);

  public value = '';
  public onChange: (value: string) => void = () => {};
  public onTouched: () => void = () => {};

  public get textareaClass(): string {
    return ['scoular-form-textarea', this.class()].filter(Boolean).join(' ');
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
