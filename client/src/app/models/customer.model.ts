import { Coordinates } from './coordinates.model';

export interface Customer {
  id: string;
  sourceCustomerId?: string; // Used to match with contract ctrmCustomerId
  name: string;
  farm: string;
  location: string;
  phone: string;
  email: string;
  totalAcres: number;
  farmIds: string[];
  linkedProducerIds: string[];
  eSignEnabled: boolean;
  coordinates?: Coordinates;
}
