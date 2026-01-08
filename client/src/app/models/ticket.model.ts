export interface Ticket {
  id: string;
  customerId: string;
  farmId: string;
  date: Date;
  crop: string;
  grossWeight: number;
  tareWeight: number;
  netWeight: number;
  moisture: number;
  testWeight: number;
}
