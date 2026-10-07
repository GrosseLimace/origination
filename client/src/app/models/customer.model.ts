import { Coordinates } from './coordinates.model';
import { GrainOnFarmItem, ProducerBinSiteItem, ProducerContactItem } from './producer-details.model';

export interface Customer {
  id: number;             // Maps to bigint in C# API
  scoularId?: string; // Used to match with contract ctrmCustomerId
  name: string;
  farm: string;
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
  totalAcres: number;
  linkedProducerIds: string[];
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

  // CustomerDetails fields (populated from app DB / ProducerDetails table)
  binCapacity?: number;       // Bushels - bin storage capacity
  grainOnFarm?: GrainOnFarmItem[]; // Per-commodity bushels on hand + target
  commodities?: string[];     // e.g. ['Corn', 'Soybeans', 'Wheat']
  primaryContact?: string;    // Derived from the primary contact row (kept for compat/search)
  primaryPhone?: string;      // Derived from the primary contact row (kept for compat/search)
  contacts?: ProducerContactItem[]; // User-entered contacts, primary first
  binSites?: ProducerBinSiteItem[]; // User-entered bin sites (max 3), display order

  // Onboarding: true when a user manually added this producer (assigned trade units)
  // rather than the nightly sync. Used to distinguish ODS search candidates and to
  // (later) lock sync-sourced trade-unit assignments in the edit dialog.
  isManual?: boolean;
  // True only on ODS search-fallback candidates — they exist in CTRM but aren't in our
  // tables yet. Set client-side, not from the API.
  isOnboardCandidate?: boolean;
}
