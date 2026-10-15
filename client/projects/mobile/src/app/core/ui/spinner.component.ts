import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The loading spinner used throughout the desktop Workbench (user 2026-10-14: "use the spinner we usually
 * use"): a grey ring with a Scoular-green top, centred above a short grey message. Same classes as the
 * desktop's inline spinners (e.g. build-list "Loading queries..."), so the two apps look alike.
 */
@Component({
  selector: 'mob-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-center justify-center" [class]="compact() ? 'py-3' : 'py-8'" role="status" aria-live="polite">
      <div class="inline-block animate-spin rounded-full border-4 border-gray-300 dark:border-gray-600 border-t-scoular-green dark:border-t-scoular-green"
           [class]="compact() ? 'h-6 w-6' : 'h-8 w-8'" aria-hidden="true"></div>
      @if (label()) {
        <p class="text-sm text-gray-500 dark:text-gray-400 font-medium text-center" [class]="compact() ? 'mt-2' : 'mt-4'">{{ label() }}</p>
      }
    </div>
  `,
})
export class SpinnerComponent {
  readonly label = input<string>('');
  /** Smaller ring and padding, for a spinner inside a card or an expanded row. */
  readonly compact = input(false);
}
