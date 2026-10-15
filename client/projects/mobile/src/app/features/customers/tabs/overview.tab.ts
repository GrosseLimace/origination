import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, resource, signal } from '@angular/core';

import {
  Commodity, Contact, CustomerDetail, MobileApiService, ProducerDetails, ProducerDetailsUpdate, newClientRequestId,
} from '../../../core/api/mobile-api.service';
import { NoticeService } from '../../../core/errors/notice.service';
import { SyncQueueService } from '../../../core/offline/sync-queue.service';
import { SpinnerComponent } from '../../../core/ui/spinner.component';
import { ContactCardComponent } from './contact-card.component';
import { FarmCardComponent } from './farm-card.component';
import { FarmChange, FarmRecord, SaveFn } from './farm.model';

/**
 * The producer at a glance, one scrolling page laid out like the desktop profile (user 2026-10-14):
 * the Contact card, then the Farm details card (acres, bin sites each with its grain on farm).
 *
 * This component owns the data and every save. A save sends the WHOLE farm record with the one change
 * applied — total acres is always written, and the sites and grain go back with every field that was read
 * (site keys, coordinates, last bid) — plus `expectedModifiedAt`, so a desktop edit made in between comes back
 * as a 409 instead of being overwritten. Contacts are sent only when they are what changed.
 *
 * Without signal the save is kept on the phone (SyncQueueService, Burdi's pattern) and shown straight away; until
 * it is sent, the cards show the queued values and "Waiting to sync", even after the page is reopened.
 */
@Component({
  selector: 'mob-overview-tab',
  imports: [SpinnerComponent, ContactCardComponent, FarmCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- flex + gap, not space-y: the cards are custom elements (inline by default), so margins would not apply. -->
    <div class="flex flex-col gap-4 pb-6">
      <mob-contact-card [customer]="customerView()" [canEdit]="!!farm()" [saveFn]="save" [syncPending]="!!pendingContacts()"
                        [locked]="openCard() === 'farm'" (editingChange)="onEditing('contact', $event)" />

      @if (farm(); as f) {
        <mob-farm-card [farm]="f" [commodities]="commodities.value() ?? []" [saveFn]="save" [syncPending]="!!pendingEdit()"
                       [locked]="openCard() === 'contact'" (editingChange)="onEditing('farm', $event)" />
      } @else if (details.error()) {
        <section class="mob-card"><h2 class="mob-label">Farm details</h2>
          <p class="mt-1 text-sm text-red-700 dark:text-red-400" role="alert">Couldn't load farm details right now.</p></section>
      } @else {
        <section class="mob-card"><h2 class="mob-label">Farm details</h2><mob-spinner label="Loading farm details…" [compact]="true" /></section>
      }
    </div>
  `,
})
export class OverviewTab {
  private readonly api = inject(MobileApiService);
  private readonly notices = inject(NoticeService);
  private readonly queue = inject(SyncQueueService);

  readonly customer = input.required<CustomerDetail>();
  /** Contacts were saved: the page reloads the producer so the new contacts show. */
  readonly contactsChanged = output<void>();

  protected readonly details = resource<ProducerDetails, number>({
    params: () => this.customer().id,
    loader: ({ params }) => this.api.getProducerDetails(params),
  });
  protected readonly commodities = resource<Commodity[], void>({ loader: () => this.api.getPlantingCommodities() });

  /** Which card has an editor open — only one at a time, so there is only ever one Save (user 2026-10-14). */
  protected readonly openCard = signal<'contact' | 'farm' | null>(null);

  protected onEditing(card: 'contact' | 'farm', open: boolean): void {
    if (open) this.openCard.set(card);
    else if (this.openCard() === card) this.openCard.set(null);
  }

  /** The farm record as last read, every site keyed (legacy sites get a key now) so grain can point at it. */
  protected readonly farm = signal<FarmRecord | null>(null);

  /** This producer's edit still on the phone, if any (refused ones are left to the sync issues box). */
  protected readonly pendingEdit = computed<ProducerDetailsUpdate | null>(
    () => {
      const item = this.queue.items().find((i) => i.kind === 'details-update' && i.customerId === this.customer().id && i.status !== 'error');
      return item ? (item.body as ProducerDetailsUpdate) : null;
    },
    // The queue re-reads storage on every change; only a different edit should reset the cards.
    { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );

  protected readonly pendingContacts = computed(() => this.pendingEdit()?.contacts ?? null);

  /** The producer with queued contact edits shown in place of the saved ones. */
  protected readonly customerView = computed<CustomerDetail>(() => {
    const contacts = this.pendingContacts();
    return contacts ? { ...this.customer(), contacts: contacts as Contact[] } : this.customer();
  });

  constructor() {
    effect(() => {
      const d = this.details.hasValue() ? this.details.value() : null;
      if (!d) return;
      const queued = this.pendingEdit();
      this.farm.set({
        acres: queued ? (queued.totalAcres ?? null) : (d.totalAcres ?? null),
        sites: (queued?.binSites ?? d.binSites).map((s) => ({ ...s, siteKey: s.siteKey ?? newClientRequestId() })),
        grain: (queued?.grainOnFarm ?? d.grainOnFarm).map((g) => ({ ...g })),
        modifiedAt: d.modifiedAt ?? null,
        modifiedBy: d.modifiedBy ?? null,
      });
    });

    // The queue delivered this producer's edit: show the server's version (and the page reloads the contacts).
    effect(() => {
      const synced = this.queue.synced();
      if (synced?.kind === 'details-update' && synced.customerId === this.customer().id) {
        this.details.reload();
        this.contactsChanged.emit();
      }
    });
  }

  /** One save path for both cards. Rejects (after the error is shown) so the card stays open to retry. */
  protected readonly save: SaveFn = async (change: FarmChange) => {
    const f = this.farm();
    if (!f) throw new Error('Farm details are not loaded yet.');
    const result = await this.queue.submit({
      kind: 'details-update',
      customerId: this.customer().id,
      body: {
        clientRequestId: newClientRequestId(),
        totalAcres: change.acres !== undefined ? change.acres : f.acres,
        binSites: change.sites ?? f.sites,
        grainOnFarm: change.grain ?? f.grain,
        ...(change.contacts ? { contacts: change.contacts } : {}),
        expectedModifiedAt: f.modifiedAt,
      },
    });
    if (result === 'queued') {
      // pendingEdit now shows the queued values on both cards.
      this.notices.info('Saved on this phone. It will be sent when you are back online.');
      return;
    }
    this.details.reload();
    if (change.contacts) this.contactsChanged.emit();
    this.notices.info('Saved.');
  };
}
