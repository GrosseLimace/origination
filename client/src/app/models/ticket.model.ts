export interface Ticket {
  id: string;
  customerId: string;
  farmId: string;
  ticketNumber: string;
  crop: string;           // Grain type (Corn, Soybeans, Wheat)
  grossWeight: number;    // Pounds
  tareWeight: number;     // Pounds
  netWeight: number;      // Pounds (Gross - Tare)
  moisture: number;       // Percentage
  testWeight: number;     // Pounds per bushel
  date: Date;             // When delivered
}
