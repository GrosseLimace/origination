import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { Contract } from '@models';
import { ContractPacingApiService } from './contract-pacing-api.service';

/** What has been read of one producer's history. */
interface HistoryRead {
  customerId: number | null;
  contracts: Contract[];
  /** The read failed, so the year-over-year comparison is understated rather than genuinely flat. */
  failed: boolean;
}

/**
 * The selected producer's closed contracts, which the pacing figures compare this year against: Harvest Contract
 * Pace, Producer Insights, the Contract Pacing card and Activity Summary. Read once per producer however many of them
 * ask, and again when another producer is picked. Each asks with `load` for the producer it shows, and reads
 * `contractsFor` and `failedFor` for that producer, so it never shows another producer's history.
 */
@Injectable({ providedIn: 'root' })
export class ContractPacingHistoryStore {
  private readonly api = inject(ContractPacingApiService);
  private readonly read = signal<HistoryRead>({ customerId: null, contracts: [], failed: false });
  private request?: Subscription;

  /** Reads the producer's history, unless it is the producer already read or being read. */
  load(customerId: number | null): void {
    if (customerId === this.read().customerId) return;
    this.request?.unsubscribe();
    // A previous producer's failure is cleared as the read starts, so it never shows against this one.
    this.read.set({ customerId, contracts: [], failed: false });
    if (customerId == null) return;
    this.request = this.api.historicalContracts(customerId).subscribe({
      next: contracts => this.read.set({ customerId, contracts, failed: false }),
      // Producer-scoped: the trade-unit-wide flag drives Build a List's banner, and this read says nothing about that.
      error: () => this.read.set({ customerId, contracts: [], failed: true }),
    });
  }

  /** The producer's closed contracts; none while they are still loading, or for another producer. */
  contractsFor(customerId: Signal<number | null>): Signal<Contract[]> {
    return computed(() => (this.read().customerId === customerId() ? this.read().contracts : []));
  }

  /** Whether the producer's history could not be read. */
  failedFor(customerId: Signal<number | null>): Signal<boolean> {
    return computed(() => this.read().customerId === customerId() && this.read().failed);
  }
}
