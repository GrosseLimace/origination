import { Component, input, output, inject, DestroyRef, effect, computed, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Document-level so Escape works wherever focus sits: inside the dialog, or still on the
  // trigger button, which is where it usually is at the moment the dialog opens.
  host: { '(document:keydown.escape)': 'onEscape()' },
  template: `
    @if (isOpen()) {
      <!-- Backdrop -->
      <div class="fixed inset-0 bg-black/55 z-[60]" (click)="onBackdropClick()"></div>

      <!-- Dialog wrapper -->
      <div class="fixed inset-0 z-[60] flex justify-center px-4 overflow-y-auto" [class]="alignClass" (click)="onBackdropClick()">
        <div
          class="relative w-full bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700"
          [class]="panelClass"
          (click)="$event.stopPropagation()"
        >
          @if (showCloseButton()) {
            <button
              type="button"
              class="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 bg-transparent border-0 p-0 z-10"
              aria-label="Close dialog"
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
export class DialogComponent {
  public isOpen = input<boolean>(false);
  public size = input<'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'>('md');
  public closeOnBackdrop = input<boolean>(true);
  /** Escape dismisses the dialog, as a modal is expected to. Opt out for the rare dialog where
   *  abandoning part-way would lose work, and pair that with closeOnBackdrop false. */
  public closeOnEscape = input<boolean>(true);
  public showCloseButton = input<boolean>(true);
  /** Scroll the body instead of the whole panel, so the title and the footer
   *  actions stay put. Worth turning on for any dialog tall enough to scroll on
   *  a laptop, where the buttons would otherwise scroll out of reach. */
  public scrollBody = input<boolean>(false);
  /** Vertical placement. 'center' (default) keeps the existing centered behavior;
   *  'top' anchors the dialog in the upper third — better for short confirm dialogs
   *  that otherwise read as "low" when dead-centered on a tall viewport. */
  public align = input<'center' | 'top'>('center');
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

  public get alignClass(): string {
    // 'top' uses a viewport-relative top offset so the dialog sits in the upper
    // third; 'center' preserves the original items-center + py-8 spacing.
    return this.align() === 'top' ? 'items-start pt-[12vh] pb-8' : 'items-center py-8';
  }

  public get sizeClass(): string {
    const sizes: Record<string, string> = {
      sm: 'max-w-sm',
      md: 'max-w-3xl',
      lg: 'max-w-4xl',
      xl: 'max-w-5xl',
      '2xl': 'max-w-7xl',
      full: 'max-w-[1400px] w-[95vw]'
    };
    return sizes[this.size()];
  }

  public get panelClass(): string {
    // The cap has to account for the wrapper's own offset, or a full-height
    // dialog runs off the bottom of a short screen: 'top' adds 12vh above the
    // panel and 2rem below, 'center' adds 4rem split between the two.
    const maxHeight = this.align() === 'top'
      ? 'max-h-[calc(88dvh-2rem)]'
      : 'max-h-[calc(100dvh-4rem)]';
    // Scrolling the body means the panel itself must not scroll.
    const overflow = this.scrollBody() ? 'flex flex-col overflow-hidden' : 'overflow-y-auto';
    return `${this.sizeClass} ${maxHeight} ${overflow}`;
  }

  public onEscape(): void {
    if (this.isOpen() && this.closeOnEscape()) {
      this.close.emit();
    }
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Inert unless the dialog scrolls its body, where this keeps the title from
  // being squeezed by a tall body.
  host: { 'class': 'shrink-0' },
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
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  // display:contents makes the inner div a direct flex item of the dialog panel,
  // which is what lets it take the leftover height when the body scrolls.
  host: { '[style.display]': "scrolls() ? 'contents' : null" },
  template: `
    <div [class]="scrolls() ? 'p-6 flex-1 min-h-0 overflow-y-auto' : 'p-6'">
      <ng-content></ng-content>
    </div>
  `
})
export class DialogContentComponent {
  // Content projected into <app-dialog> is a logical child of it, so the element
  // injector resolves the host dialog here.
  private readonly dialog = inject(DialogComponent, { optional: true });
  readonly scrolls = computed(() => this.dialog?.scrollBody() ?? false);
}

@Component({
  selector: 'app-dialog-footer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Keeps the action buttons anchored when the dialog scrolls its body.
  host: { 'class': 'shrink-0' },
  template: `
    <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 p-6 pt-4">
      <ng-content></ng-content>
    </div>
  `
})
export class DialogFooterComponent {}
