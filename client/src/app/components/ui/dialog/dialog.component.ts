import { Component, input, output, inject, DestroyRef, effect } from '@angular/core';

@Component({
  selector: 'app-dialog',
  standalone: true,
  template: `
    @if (isOpen()) {
      <!-- Backdrop -->
      <div class="scoular-modal-overlay" (click)="onBackdropClick()"></div>

      <!-- Dialog content -->
      <div
        class="fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800 max-h-[calc(100vh-4rem)] overflow-y-auto"
        [class]="sizeClass"
      >
        @if (showCloseButton()) {
          <button
            type="button"
            class="scoular-btn-icon absolute top-4 right-4 z-10"
            (click)="close.emit()"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        }
        <ng-content></ng-content>
      </div>
    }
  `
})
export class DialogComponent {
  public isOpen = input<boolean>(false);
  public size = input<'sm' | 'md' | 'lg' | 'xl'>('md');
  public closeOnBackdrop = input<boolean>(true);
  public showCloseButton = input<boolean>(true);
  public close = output<void>();

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(() => {
      document.body.style.overflow = this.isOpen() ? 'hidden' : '';
    });

    destroyRef.onDestroy(() => {
      document.body.style.overflow = '';
    });
  }

  public get sizeClass(): string {
    const sizes: Record<string, string> = {
      sm: 'max-w-sm',
      md: 'max-w-3xl',
      lg: 'max-w-4xl',
      xl: 'max-w-5xl'
    };
    return sizes[this.size()];
  }

  public onBackdropClick(): void {
    if (this.closeOnBackdrop()) {
      this.close.emit();
    }
  }
}

@Component({
  selector: 'app-dialog-header',
  standalone: true,
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
  template: `
    <h2 class="scoular-modal-title">
      <ng-content></ng-content>
    </h2>
  `
})
export class DialogTitleComponent {}

@Component({
  selector: 'app-dialog-description',
  standalone: true,
  template: `
    <p class="scoular-modal-body">
      <ng-content></ng-content>
    </p>
  `
})
export class DialogDescriptionComponent {}

@Component({
  selector: 'app-dialog-content',
  standalone: true,
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
  template: `
    <div class="scoular-modal-footer flex-col-reverse sm:flex-row">
      <ng-content></ng-content>
    </div>
  `
})
export class DialogFooterComponent {}
