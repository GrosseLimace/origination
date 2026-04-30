import { Coordinates } from './coordinates.model';

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
  scoularViewRecipients?: string;  // Comma-separated "Name | email/phone", from dbo.eSignEnrollment
  guild?: string;                  // Guild name, from dbo.eSignEnrollment
  coordinates?: Coordinates;

  // CustomerDetails fields (populated from app DB / ProducerDetails table)
  binCapacity?: number;       // Bushels - bin storage capacity
  commodities?: string[];     // e.g. ['Corn', 'Soybeans', 'Wheat']
  primaryContact?: string;    // User-entered primary contact name
}
