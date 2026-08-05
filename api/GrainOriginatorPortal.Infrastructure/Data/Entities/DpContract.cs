namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// A delayed-pricing (DP) contract position — grain delivered against a DP contract that is still
/// accruing storage-style charges. Source: <c>ctrm.vw_GNTA70D1</c>, one row per ticket line.
///
/// Deliberately shaped to parallel <see cref="StoredGrain"/> (the customer-storage report
/// <c>ctrm.vw_GNTA39D1</c>) so the DP Contracts tab and the Storage tab read the same way. Two
/// necessary divergences from that entity:
/// <list type="bullet">
///   <item><description><see cref="LocationName"/> is a single "City, ST" string resolved in C# from
///   <c>dbo.MbpLocationSynonym</c> (the app DB — no cross-database join is possible), not the
///   city/state pair Storage gets from the ODS elevator master. The view carries no elevator or
///   location code, only <see cref="TradeUnitCode"/>.</description></item>
///   <item><description><see cref="Bushels"/> is nullable. The view reports quantity in whatever
///   <see cref="QuantityUom"/> says, so bushels are only populated when the UOM is bushels outright
///   or a conversion factor exists. Null means "we cannot substantiate a bushel figure" and must
///   render as blank rather than falling back to the raw <see cref="Quantity"/>.</description></item>
/// </list>
/// </summary>
public class DpContract
{
    /// <summary>
    /// Row identity: <see cref="TicketKey"/> plus the charge-type <see cref="Status"/>. Unique per row.
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Identifies one PHYSICAL delivery (ticket prefix|number|suffix|sequence|trade unit), shared by
    /// every charge-type row for that delivery. Confirmed in prod: a ticket has one row per charge
    /// type (e.g. Status '2' flat initial charge + Status 'S' accruing storage rate), and each row
    /// repeats the SAME <see cref="Quantity"/>. Count bushels once per TicketKey; summing
    /// <see cref="Bushels"/> across rows double-counts the grain. Charge amounts ARE additive.
    /// </summary>
    public string TicketKey { get; set; } = string.Empty;

    /// <summary>Ticket_Number — the grain ticket this DP line came in on.</summary>
    public string TicketNumber { get; set; } = string.Empty;

    /// <summary>
    /// Business-facing contract identifier: <c>Contract_Prefix_Type</c> + <c>Contract_Prefix_Cmdy</c>
    /// + <c>Contract_Number</c>, run together with no separator — e.g. P + C + PL84649 =
    /// <c>"PCPL84649"</c>. The suffix is intentionally excluded (see <see cref="ContractSuffix"/>).
    /// </summary>
    public string ContractNumber { get; set; } = string.Empty;

    /// <summary>Contract_Prefix_Type — 'P' = Purchase. Kept for the DP-vs-unapplied-ticket question.</summary>
    public string ContractPrefixType { get; set; } = string.Empty;

    /// <summary>Contract_Prefix_Cmdy — commodity letter of the contract series (e.g. 'C' for corn).</summary>
    public string ContractPrefixCommodity { get; set; } = string.Empty;

    /// <summary>
    /// Contract_Suffix (e.g. 'A'). Excluded from <see cref="ContractNumber"/> per the business, so
    /// suffixes of the same contract number group together in the UI. Carried here in case a caller
    /// needs to tell them apart.
    /// </summary>
    public string ContractSuffix { get; set; } = string.Empty;

    /// <summary>Ticket_Status — CTRM ticket state, e.g. "U/L" (unload).</summary>
    public string TicketStatus { get; set; } = string.Empty;

    /// <summary>Numeric CustomerId from dbo.Customer — resolved in C#, not by the ODS query.</summary>
    public long CustomerId { get; set; }

    /// <summary>Customer_Id — the CTRM Scoular customer code (same as Customer.ScoularId).</summary>
    public string CustomerCode { get; set; } = string.Empty;

    /// <summary>Trade_Unit_Code — also the MbpLocationSynonym.LocationId used to resolve the location.</summary>
    public string TradeUnitCode { get; set; } = string.Empty;

    /// <summary>Commodity_Code — the CTRM commodity code (e.g. "YC"), used for grouping and crop colors.</summary>
    public string Crop { get; set; } = string.Empty;

    /// <summary>Net_Quantity in <see cref="QuantityUom"/> units — NOT necessarily bushels.</summary>
    public decimal Quantity { get; set; }

    /// <summary>Gross_Quantity in <see cref="QuantityUom"/> units.</summary>
    public decimal GrossQuantity { get; set; }

    /// <summary>Quantity_Uom — a 2-char CTRM unit code: BU, LB, CW (hundredweight), TN (ton).</summary>
    public string QuantityUom { get; set; } = string.Empty;

    /// <summary>
    /// Net quantity expressed in bushels, or <c>null</c> when it cannot be determined (unrecognized or
    /// blank UOM, or no conversion factor for the commodity). Populated in C# by
    /// <see cref="DpBushelConversion.ToBushels"/>.
    /// </summary>
    public decimal? Bushels { get; set; }

    /// <summary>Storage_Days — days accrued on DP.</summary>
    public decimal StorageDays { get; set; }

    /// <summary>Decide_Free_Days — free-decide window before charges begin.</summary>
    public decimal DecideFreeDays { get; set; }

    /// <summary>Storage_Rate — per-unit-per-day charge rate.</summary>
    public decimal StorageRate { get; set; }

    /// <summary>Receivable_Amount — accumulated charge owed.</summary>
    public decimal ReceivableAmount { get; set; }

    /// <summary>Prepaid_Amount — charges already paid.</summary>
    public decimal PrepaidAmount { get; set; }

    /// <summary>Unearned_Storage_Amt — prepaid but not yet earned.</summary>
    public decimal UnearnedStorageAmount { get; set; }

    /// <summary>Unpaid_Handling_Amt — handling charges outstanding.</summary>
    public decimal UnpaidHandlingAmount { get; set; }

    public DateTime StorageStartDate { get; set; }
    public DateTime ChargedFromDate { get; set; }
    public DateTime ChargedThruDate { get; set; }
    public DateTime PaidThruDate { get; set; }
    public DateTime BolDate { get; set; }

    /// <summary>Status — CTRM single-char status code.</summary>
    public string Status { get; set; } = string.Empty;
    /// <summary>Status_Description — human-readable status text.</summary>
    public string StatusDescription { get; set; } = string.Empty;

    /// <summary>Storage_Program_Code — which DP/storage program this line sits on.</summary>
    public string StorageProgramCode { get; set; } = string.Empty;

    /// <summary>Storage_Error_Flag — CTRM sets this when the line failed storage calculation.</summary>
    public string StorageErrorFlag { get; set; } = string.Empty;
    /// <summary>Storage_Error_Desc — accompanying error text.</summary>
    public string StorageErrorDescription { get; set; } = string.Empty;

    /// <summary>Resolved "City, ST" display name; empty when the trade unit has no curated location.</summary>
    public string LocationName { get; set; } = string.Empty;
}
