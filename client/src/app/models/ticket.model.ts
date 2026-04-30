export interface Ticket {
  id: number;             // Maps to bigint in C# API
  contractId?: number;    // FK to Contract - direct relationship
  customerId?: number;    // FK to Customer
  customerCode?: string;  // Customer code for string matching with Customer.scoularId
  farmId: string;

  // Ticket identifiers
  productCode?: string;   // Grain type/product code
  ticketPrefix?: string;
  ticketNumber: string;
  ticketSuffix?: string;
  shipmentTicketNumber?: string; // Full shipment ticket number from ODS
  ctrmContractNumber?: string; // Contract number from CTRM system
  organizationCode?: string; // Organization code / trade unit
  elevatorCode?: string;     // Elevator code from ODS ticket
  elevatorCity?: string;     // City from elevator lookup
  elevatorState?: string;    // State from elevator lookup

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

  // Classification — maps to GNP014.BCPFXT via ODS TicketType column
  ticketType?: string;  // P=Purchase, S=Sale, U=Unload, L=Loadout, B=Booking
  isApplied: boolean;   // server-computed: false only when first char of ctrmContractNumber is U (Unload) or L (Loadout) — those are unapplied tickets. Everything else (P, S, C=Customer Storage, B, or no contract) is applied.

  // Status
  ticketStatusDescription?: string; // e.g. "Unload", "Final Settled", "P/A", "Force-Matched Unload"
  isActive: boolean;
}
