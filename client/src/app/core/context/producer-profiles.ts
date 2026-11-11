import { Signal } from '@angular/core';
import { Observable } from 'rxjs';
import { ProducerDetails } from '@models';

/**
 * Every producer's saved details (dbo.ProducerDetails and its contacts, bin sites and grain on farm), by customer id:
 * the producer's profile, as everything that shows or filters on it reads it. Declared in core so a module that may
 * not import Producers (Customers, for the home page and the customer list) can read and update it; the Producers
 * module's ProducerProfileStore is the implementation, which the composition root provides.
 */
export abstract class ProducerProfiles {
  /** Every producer's details, by customer id. Empty until the first read lands, and for a user who may not read them. */
  abstract readonly profiles: Signal<ReadonlyMap<number, ProducerDetails>>;
  /** Whether a full read has landed since sign-in. */
  abstract readonly loaded: Signal<boolean>;
  /** One producer's details, or undefined. Read in a computed or a template, it follows them as they change. */
  abstract profileOf(customerId: number): ProducerDetails | undefined;
  /**
   * Reads every producer's details again and keeps them, sharing a read that is already running. Emits them once,
   * when it lands: none, without a request, for a user who may not read them. A failure is passed on to the
   * subscriber and leaves the details as they were.
   */
  abstract load(): Observable<ProducerDetails[]>;
  /** Puts in one producer's details, after reading or saving them on their own. */
  abstract put(details: ProducerDetails): void;
}
