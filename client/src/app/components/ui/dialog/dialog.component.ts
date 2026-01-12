import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (isOpen) {
      <div class="fixed inset-0 z-50 flex items-start justify-center py-8 px-4 overflow-y-auto">
        <!-- Backdrop -->
        <div
          class="fixed inset-0 bg-black/55"
          (click)="onBackdropClick()"
        ></div>

        <!-- Dialog content -->
        <div
          class="relative z-50 w-full mx-4 bg-white dark:bg-gray-800 rounded-lg shadow-xl max-h-[calc(100vh-4rem)] overflow-y-auto"
          [class]="sizeClass"
        >
          <ng-content></ng-content>
        </div>
      </div>
    }
  `
})
export class DialogComponent {
  @Input() isOpen = false;
  @Input() size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  @Input() closeOnBackdrop = true;
  @Output() close = new EventEmitter<void>();

  get sizeClass(): string {
    const sizes = {
      sm: 'max-w-sm',
      md: 'max-w-lg',
      lg: 'max-w-2xl',
      xl: 'max-w-4xl'
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
    <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
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
    <div class="p-4">
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
    <div class="flex items-center justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
      <ng-content></ng-content>
    </div>
  `
})
export class DialogFooterComponent {}
