import { Component, input, signal, forwardRef, ViewChild, ElementRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';

@Component({
  selector: 'app-input',
  standalone: true,
  imports: [FormsModule],
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
      [type]="type()"
      [placeholder]="placeholder()"
      [disabled]="disabled()"
      [class]="inputClass"
      [attr.inputmode]="inputmode() || null"
      [(ngModel)]="value"
      (ngModelChange)="onChange($event)"
      (blur)="onTouched()"
      (click)="onInputClick()"
    />
  `
})
export class InputComponent implements ControlValueAccessor {
  @ViewChild('inputElement') inputElement!: ElementRef<HTMLInputElement>;

  public type = input<string>('text');
  public inputmode = input<string>('');
  public placeholder = input<string>('');
  public class = input<string>('');

  public disabled = signal<boolean>(false);

  public value = '';
  public onChange: (value: string) => void = () => {};
  public onTouched: () => void = () => {};

  public onInputClick(): void {
    if (this.type() === 'date' && this.inputElement?.nativeElement?.showPicker) {
      try {
        this.inputElement.nativeElement.showPicker();
      } catch {
        // showPicker() may throw if already open or not supported
      }
    }
  }

  public get inputClass(): string {
    const dateClass = this.type() === 'date' ? 'dark:[color-scheme:dark]' : '';
    return ['scoular-form-input h-10', dateClass, this.class()].filter(Boolean).join(' ');
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
