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
    <div class="relative">
      <input
        #inputElement
        [type]="type()"
        [placeholder]="placeholder()"
        [disabled]="disabled()"
        [class]="inputClass"
        [attr.inputmode]="inputmode() || null"
        [attr.maxlength]="maxlength() || null"
        [(ngModel)]="value"
        (ngModelChange)="onChange($event)"
        (blur)="onTouched()"
        (click)="onInputClick()"
      />
      @if (clearable() && value && !disabled()) {
        <button
          type="button"
          tabindex="-1"
          aria-label="Clear"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          (mousedown)="$event.preventDefault()"
          (click)="clear()"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18"/>
            <path d="M6 6l12 12"/>
          </svg>
        </button>
      }
    </div>
  `
})
export class InputComponent implements ControlValueAccessor {
  @ViewChild('inputElement') inputElement!: ElementRef<HTMLInputElement>;

  public type = input<string>('text');
  public inputmode = input<string>('');
  public placeholder = input<string>('');
  public maxlength = input<number | null>(null);
  public class = input<string>('');
  /** When true, shows an X button that clears the field while it has a value. */
  public clearable = input<boolean>(false);

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
    // Reserve room on the right so typed text doesn't sit under the clear button.
    const clearPad = this.clearable() ? 'pr-9' : '';
    return ['scoular-form-input h-10', dateClass, clearPad, this.class()].filter(Boolean).join(' ');
  }

  /** Clears the field and notifies the form binding, keeping focus in the input. */
  public clear(): void {
    this.value = '';
    this.onChange('');
    this.inputElement?.nativeElement?.focus();
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
