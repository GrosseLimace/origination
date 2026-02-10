import { Coordinates } from './coordinates.model';

export interface Customer {
  id: number;             // Maps to bigint in C# API
  sourceCustomerId?: string; // Used to match with contract ctrmCustomerId
  name: string;
  farm: string;
  location: string;
  stateProvince?: string; // State/province for location display
  phone: string;
  email: string;
  extendedPrimaryPhone?: string; // Fallback phone number
  supplementalEmail?: string;    // Fallback email
  totalAcres: number;
  farmIds: string[];
  linkedProducerIds: string[];
  eSignEnabled: boolean;
  coordinates?: Coordinates;
}
