/**
 * A delayed-pricing (DP) contract position — grain delivered against a DP contract that is still
 * accruing storage-style charges. Source: ODS `ctrm.vw_GNTA70D1`, one row per ticket line.
 *
 * Shaped to parallel `StoredGrain` so the DP Contracts tab reads like the Storage tab. Two fields
 * carry meaning in their nullability and must be rendered as blank (never zero, never a fallback):
 *  - `bushels` is null when the source quantity can't be substantiated in bushels.
 *  - the date fields are null when CTRM reported a "no date" sentinel.
 */
export interface DpContract {
  id: string;              // ticketKey + charge-type status. Unique per row.
  /**
   * One PHYSICAL delivery, shared by every charge-type row for it. The view emits one row per charge
   * type (e.g. flat initial charge + accruing storage rate), each repeating the SAME quantity — so
   * bushels must be counted once per ticketKey. Use the helpers in @shared/utils/dp-aggregate rather
   * than reducing rows directly.
   */
  ticketKey: string;
  ticketNumber: string;
  /** prefixType + prefixCommodity + number, no separator — e.g. "PCPL84649". Suffix excluded. */
  contractNumber: string;
  contractPrefixType: string;      // 'P' = Purchase
  contractPrefixCommodity: string; // Commodity letter of the contract series
  contractSuffix: string;          // e.g. 'A' — deliberately not part of contractNumber
  ticketStatus: string;            // e.g. "U/L" (unload)
  customerId: number;      // Numeric CustomerId from dbo.Customer
  customerCode: string;    // CTRM Customer_Id (same as Customer.scoularId)
  tradeUnitCode: string;   // Also the MbpLocationSynonym LocationId behind locationName
  crop: string;            // Commodity_Code

  quantity: number;        // Net_Quantity in quantityUom units — NOT necessarily bushels
  grossQuantity: number;
  quantityUom: string;     // CTRM 2-char unit code: BU, LB, CW, TN

  /** Net quantity in bushels, or null when unconvertible. Render blank when null. */
  bushels: number | null;

  storageDays: number;
  decideFreeDays: number;
  storageRate: number;
  receivableAmount: number;   // Accumulated charge owed
  prepaidAmount: number;
  unearnedStorageAmount: number;
  unpaidHandlingAmount: number;

  storageStartDate: Date | null;
  chargedFromDate: Date | null;
  chargedThruDate: Date | null;
  paidThruDate: Date | null;
  bolDate: Date | null;

  status: string;
  statusDescription: string;
  storageProgramCode: string;
  storageErrorFlag: string;
  storageErrorDescription: string;

  /** Resolved "City, ST"; empty when the trade unit has no curated location. */
  locationName: string;
}
