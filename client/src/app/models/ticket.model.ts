export interface Ticket {
  id: number;             // Maps to bigint in C# API
  contractId?: number;    // FK to Contract - direct relationship
  customerId?: number;    // FK to Customer
  customerCode?: string;  // Customer code for string matching with Customer.sourceCustomerId
  farmId: string;

  // Ticket identifiers
  productCode?: string;   // Grain type/product code
  ticketPrefix?: string;
  ticketNumber: string;
  ticketSuffix?: string;
  shipmentTicketNumber?: string; // Full shipment ticket number from ODS
  ctrmContractNumber?: string; // Contract number from CTRM system

  // Dates
  date: string;           // TicketBlDate - stored as string in ODS
  finalSettledDate?: string; // Stored as DateTime in ODS

  // Quantities
  unloadQuantity?: number;
  loadoutQuantity?: number;
  appliedDockQuantity?: number; // Maps to AppliedNetQuantity (bigint in ODS)
  grossWeight: number;    // Pounds
  tareWeight: number;     // Pounds
  netWeight: number;      // Pounds (Gross - Tare)

  // Quality measures
  moisture?: number;      // Percentage
  testWeight?: number;    // Pounds per bushel
  proteinPercent?: number;
  gradeCode?: string;

  // Status
  isActive: boolean;
}
