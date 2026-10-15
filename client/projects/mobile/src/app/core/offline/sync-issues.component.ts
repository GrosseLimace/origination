import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { NoteCreate, PlantingIntentionCreate } from '../api/mobile-api.service';
import { QueuedOperation } from './indexed-db';
import { SyncQueueService } from './sync-queue.service';

/**
 * Changes made on the phone that the server refused when they were sent (e.g. the record was changed on the
 * desktop meanwhile). Burdi retries these forever; we stop and let the originator decide: Retry, or Discard and
 * re-enter it against the current values. Shown at the top of the producer page they belong to.
 */
@Component({
  selector: 'mob-sync-issues',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (issues().length > 0) {
      <section class="mb-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3" role="alert" aria-labelledby="sync-issues">
        <h2 id="sync-issues" class="text-sm font-semibold text-red-800 dark:text-red-300">
          {{ issues().length === 1 ? "A change from this phone couldn't be saved" : issues().length + " changes from this phone couldn't be saved" }}
        </h2>
        <ul class="mt-2 space-y-2" role="list">
          @for (i of issues(); track i.id) {
            <li class="rounded-md bg-white dark:bg-gray-800 p-2">
              <div class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ describe(i) }}</div>
              @if (i.lastError) { <div class="text-xs text-gray-600 dark:text-gray-300">{{ i.lastError }}</div> }
              <div class="mt-1 flex justify-end gap-2">
                <button type="button" class="mob-tap px-3 text-sm font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-50" [disabled]="busy()" (click)="discard(i)">Discard</button>
                <button type="button" class="mob-tap px-3 text-sm font-semibold text-scoular-green-accessible dark:text-scoular-green disabled:opacity-50" [disabled]="busy()" (click)="retry(i)">Retry</button>
              </div>
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class SyncIssuesComponent {
  private readonly queue = inject(SyncQueueService);
  readonly customerId = input.required<number>();

  protected readonly busy = signal(false);
  protected readonly issues = computed(() => this.queue.failed().filter((i) => i.customerId === this.customerId()));

  protected describe(item: QueuedOperation): string {
    switch (item.kind) {
      case 'note-create': {
        const text = (item.body as NoteCreate).content;
        return `Note: "${text.length > 60 ? text.slice(0, 60) + '…' : text}"`;
      }
      case 'details-update': return 'Edit to contacts / farm details';
      case 'planting-create': {
        const b = item.body as PlantingIntentionCreate;
        return `New planting intention: ${b.crop}, ${b.acres} ac, ${b.plantingYear}`;
      }
      case 'planting-update': return 'Edit to a planting intention';
    }
  }

  protected async discard(item: QueuedOperation): Promise<void> {
    if (item.id === undefined) return;
    await this.run(() => this.queue.discard(item.id!));
  }

  protected async retry(item: QueuedOperation): Promise<void> {
    if (item.id === undefined) return;
    await this.run(() => this.queue.retry(item.id!));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try { await action(); } finally { this.busy.set(false); }
  }
}
