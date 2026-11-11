import { Injectable, InjectionToken, Signal, computed, inject, signal } from '@angular/core';
import { Customer, CustomerSegment } from '@models';
import { AppStateService } from '@core/services/app-state.service';

/**
 * Where a deep link asked the customer screen to open: a tab, and a row or group in it. The page that hosts the
 * screen reads these from its URL; each piece of the screen acts on its own part and ignores the rest.
 */
export interface CustomerScreenLink {
  /** A tab id: 'contracts', 'tickets', 'planting', 'storage', 'dpContracts'. */
  tab?: string | null;
  /** A contract to open and scroll to, on the contracts tab. */
  contractId?: number | null;
  /** A crop to open on the tickets tab. */
  ticketCrop?: string | null;
  /** A planting year to select. */
  plantingYear?: number | null;
}

/** What the page hosting the customer screen tells the screen's pieces: the customer it shows, and its deep link. */
export interface CustomerScreenSource {
  readonly customer: Signal<Customer | null>;
  /** The producers linked to the customer, forward and reverse, that the page has loaded. */
  readonly linkedCustomers: Signal<Customer[]>;
  readonly link: Signal<CustomerScreenLink>;
}

/** Provided by the page hosting the customer screen, beside SelectedCustomerContext. */
export const CUSTOMER_SCREEN_SOURCE = new InjectionToken<CustomerScreenSource>('CUSTOMER_SCREEN_SOURCE');

/**
 * The customer the customer screen is showing, for what the modules contribute to that screen: a contribution reads
 * the customer here rather than through inputs. The home page provides one for its whole view, so the slots outside
 * the profile (the sidebar and the floating launcher) see the same customer as the profile's tabs and panels.
 */
@Injectable()
export class SelectedCustomerContext {
  private readonly source = inject(CUSTOMER_SCREEN_SOURCE, { optional: true });

  /** The selected customer, or null before one is picked: the page's own selection when it provides one. */
  readonly customer: Signal<Customer | null> = this.source?.customer ?? inject(AppStateService).selectedCustomer;

  /** The producers linked to the selected customer, forward and reverse; empty when the page doesn't say. */
  readonly linkedCustomers: Signal<Customer[]> = this.source?.linkedCustomers ?? signal<Customer[]>([]).asReadonly();

  /** Where a deep link asked the screen to open; empty when it didn't. */
  readonly link: Signal<CustomerScreenLink> = this.source?.link ?? signal<CustomerScreenLink>({}).asReadonly();

  /**
   * Set by a piece of the screen that needs the page's full width while it's shown: the contracts table with its
   * extra columns open. The page drops its sidebar meanwhile. The piece clears it when it closes.
   */
  readonly wideContent = signal(false);

  /**
   * The selected customer's segment, or null with no customer. Every customer is a producer until customers carry a
   * segment of their own.
   */
  readonly segment = computed<CustomerSegment | null>(() => {
    const customer = this.customer();
    return customer ? segmentOf(customer) : null;
  });

  /**
   * Whether a contribution applies to the selected customer: it lists no segments, or the customer's segment is among
   * them. With no customer selected, only contributions for every customer apply.
   */
  appliesTo(contribution: { readonly segments?: readonly CustomerSegment[] }): boolean {
    return appliesToSegment(contribution, this.segment());
  }
}

/** A customer's segment. Every customer is a producer until customers carry a segment of their own. */
export function segmentOf(_customer: Customer): CustomerSegment {
  return 'Producer';
}

/** Whether a contribution applies to a customer of `segment`: it lists no segments, or `segment` is among them. With no
 *  customer (null), only contributions for every customer apply. */
export function appliesToSegment(contribution: { readonly segments?: readonly CustomerSegment[] }, segment: CustomerSegment | null): boolean {
  const segments = contribution.segments ?? [];
  if (segments.length === 0) return true;
  return segment !== null && segments.includes(segment);
}
