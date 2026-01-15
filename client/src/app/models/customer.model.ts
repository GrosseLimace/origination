import { Coordinates } from './coordinates.model';

export interface Customer {
  id: string;
  name: string;
  farm: string;
  location: string;
  phone: string;
  email: string;
  totalAcres: number;
  farmIds: string[];
  eSignEnabled: boolean;
  coordinates?: Coordinates;
}
