import { Coordinates } from './coordinates.model';

/** The kind of customer, which decides what the customer screen shows for it. Named as the API names them. */
export type CustomerSegment = 'Producer' | 'Commercial';

export interface Customer {
  id: number;             // Maps to bigint in C# API
  scoularId?: string; // Used to match with contract ctrmCustomerId
  name: string;
  location: string;
  stateProvince?: string; // State/province for location display
  addressLine1?: string;  // MerchandisingAddressLine1
  postalCode?: string;    // MerchandisingPostalCode
  phone: string;
  email: string;
  extendedPrimaryPhone?: string; // Fallback phone number
  supplementalEmail?: string;    // Fallback email

  // Extended address fields — more accurate location for geocoding
  extendedAddressLine1?: string;
  extendedAddressLine2?: string;
  extendedAddressLine3?: string;
  extendedAddressLine4?: string;
  extendedCity?: string;
  extendedPostalCode?: string;
  extendedStateProvince?: string;
  extendedCountry?: string;
  eSignEnabled: boolean;
  achEnabled: boolean;             // base.Customer.PaymentMethod == 'H'
  /** The producer's active trade-unit codes. Carried on list and search results; absent on a
   *  single-customer fetch, where callers use getCustomerTradeUnits instead. */
  activeTradeUnits?: string[];

  /** CTRM industry code slot 2. 'OR' marks an organic producer — see @shared/utils/organic-visibility.
   *  Slot 1 is deliberately absent: originations.vw_CustomerTradeUnits filters on IndustryCode1 = 'PR',
   *  so every customer the app can see is already a producer and there is nothing to check. */
  industryCode2?: string;
  /** Real 10-digit National Organic Program operation id, or absent. Normalised server-side, so any
   *  value here is genuine — the '0' and '999999999' placeholders never reach the client. */
  nopId?: string;
  scoularViewRecipients?: string;  // Comma-separated "Name | email/phone", from dbo.eSignEnrollment
  guild?: string;                  // Guild name, from dbo.eSignEnrollment
  coordinates?: Coordinates;

  // A producer's acres, links, contacts, commodities, bin sites and grain on farm are their saved details, not part of
  // the customer: read them from ProducerProfiles (core/context/producer-profiles.ts).

  // Onboarding: true when a user manually added this producer (assigned trade units)
  // rather than the nightly sync. Used to distinguish ODS search candidates and to
  // (later) lock sync-sourced trade-unit assignments in the edit dialog.
  isManual?: boolean;
  // True only on ODS search-fallback candidates — they exist in CTRM but aren't in our
  // tables yet. Set client-side, not from the API.
  isOnboardCandidate?: boolean;
}
