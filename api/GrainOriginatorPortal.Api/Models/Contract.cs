using System.Text.Json.Serialization;
using GrainOriginatorPortal.Api.Json;

namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Represents a grain purchase contract with a customer.
/// Maps to the Contract table in the ODS database.
/// </summary>
public class Contract
{
    // Primary key - maps to ContractId (bigint)
    public long Id { get; set; }

    // Foreign keys and identifiers
    public long? CustomerId { get; set; } // Maps to CustomerId (bigint) in ODS - FK to Customer table
    public string? CtrmCustomerId { get; set; } // Maps to CtrmCustomerId - used for saved lists
    public string FarmId { get; set; } = string.Empty;
    public string? SourceContractId { get; set; }
    public string ContractNumber { get; set; } = string.Empty;
    public string? ContractPrefixType { get; set; } // P = Purchase, S = Sale, etc.

    // Customer info (denormalized in ODS)
    public string? CustomerName { get; set; }

    // Commodity information
    public string? CommodityCode { get; set; }
    public string? CommodityDescription { get; set; }
    public string? CommodityGroup { get; set; }

    // Trade unit / organization
    public string? TradeUnit { get; set; }

    // Quantity and pricing
    public decimal? Quantity { get; set; }
    public decimal? PricedQuantity { get; set; } // Quantity that has been priced
    public decimal? Weight { get; set; }
    public string? Unit { get; set; }
    public decimal? Price { get; set; } // Calculated: TotalValue / Quantity
    public decimal? TotalValue { get; set; } // Total contract value from ODS

    // Dates — these are ODS SQL `date` (calendar dates, no time/zone). Use the date-only
    // converter so they serialize without a UTC 'Z' and don't shift a day back in the browser.
    [JsonConverter(typeof(DateOnlyJsonConverter))]
    public DateTime? ContractDate { get; set; }
    [JsonConverter(typeof(DateOnlyJsonConverter))]
    public DateTime? DeliveryStart { get; set; } // Maps to StartShipDate
    [JsonConverter(typeof(DateOnlyJsonConverter))]
    public DateTime? DeliveryEnd { get; set; } // Maps to FinalShipDate
    [JsonConverter(typeof(DateOnlyJsonConverter))]
    public DateTime? ClosedDate { get; set; }

    // Crop year and open balance
    public int? CropYear { get; set; } // Grain crop year (e.g. 2025, 2026)
    public decimal? OpenBalanceQuantity { get; set; } // Remaining unshipped bushels
    public decimal? SettledQuantity { get; set; } // Bushels that have been settled (paid). Unsettled = (Quantity − OpenBalance) − SettledQuantity.

    // Status
    public ContractStatus Status { get; set; } = ContractStatus.Pending;
    public bool Signed { get; set; }

    // Pricing type code from ODS (e.g. "P" = priced, "U" = unpriced)
    public string? PriceTypeCode { get; set; }

    // Specialty attribute code from ODS (short code, e.g. "ORG", "NGMO", null for standard)
    public string? SpecialType { get; set; }

    // Customer confirmation status from ODS (e.g. "Confirmed", "Pending", null)
    public string? CustomerConfirmStatus { get; set; }

    // Market zone and basis price location from ODS
    public string? MarketZone { get; set; }
    public string? BasisLocation { get; set; }

    // Hedge / price market fields from base.Contract. The contracts-table "Hedge Market
    // Month" column shows HedgeMarketMonthDescription (e.g. "May 2026"), falling back to
    // PriceMarketMonthDescription, then "N/A" when both are empty.
    public string? HedgeMarketMonthDescription { get; set; }
    public string? PriceMarketMonthDescription { get; set; }

    // ODS metadata fields
    public bool IsActive { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? EffectiveStartDate { get; set; }
    public DateTime? EffectiveEndDate { get; set; }
}
