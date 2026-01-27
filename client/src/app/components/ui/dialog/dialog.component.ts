import { Component, Input, Output, EventEmitter, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (isOpen) {
      <div class="fixed inset-0 z-50 flex items-center justify-center py-8 px-4 overflow-y-auto">
        <!-- Backdrop -->
        <div
          class="fixed inset-0 bg-black/55"
          (click)="onBackdropClick()"
        ></div>

        <!-- Dialog content -->
        <div
          class="relative z-50 w-full bg-white dark:bg-gray-800 rounded-lg shadow-xl max-h-[calc(100vh-4rem)] overflow-y-auto border border-gray-200 dark:border-gray-700"
          [class]="sizeClass"
        >
          @if (showCloseButton) {
            <button
              type="button"
              class="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 bg-transparent border-0 p-0 z-10"
              (click)="close.emit()"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
              </svg>
            </button>
          }
          <ng-content></ng-content>
        </div>
      </div>
    }
  `
})
export class DialogComponent implements OnChanges, OnDestroy {
  @Input() isOpen = false;
  @Input() size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  @Input() closeOnBackdrop = true;
  @Input() showCloseButton = true;
  @Output() close = new EventEmitter<void>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']) {
      if (this.isOpen) {
        // Lock body scroll when dialog opens
        document.body.style.overflow = 'hidden';
      } else {
        // Restore body scroll when dialog closes
        document.body.style.overflow = '';
      }
    }
  }

  ngOnDestroy(): void {
    // Always restore scroll when component is destroyed
    document.body.style.overflow = '';
  }

  get sizeClass(): string {
    const sizes = {
      sm: 'max-w-sm',
      md: 'max-w-3xl',
      lg: 'max-w-4xl',
      xl: 'max-w-5xl'
    };
    return sizes[this.size];
  }

  onBackdropClick() {
    if (this.closeOnBackdrop) {
      this.close.emit();
    }
  }
}

@Component({
  selector: 'app-dialog-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex flex-col gap-1.5 text-center sm:text-left p-6 pb-0">
      <ng-content></ng-content>
    </div>
  `
})
export class DialogHeaderComponent {}

@Component({
  selector: 'app-dialog-title',
  standalone: true,
  imports: [CommonModule],
  template: `
    <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
      <ng-content></ng-content>
    </h2>
  `
})
export class DialogTitleComponent {}

@Component({
  selector: 'app-dialog-description',
  standalone: true,
  imports: [CommonModule],
  template: `
    <p class="text-sm text-gray-500 dark:text-gray-400">
      <ng-content></ng-content>
    </p>
  `
})
export class DialogDescriptionComponent {}

@Component({
  selector: 'app-dialog-content',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <ng-content></ng-content>
    </div>
  `
})
export class DialogContentComponent {}

@Component({
  selector: 'app-dialog-footer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 p-6 pt-4">
      <ng-content></ng-content>
    </div>
  `
})
export class DialogFooterComponent {}
