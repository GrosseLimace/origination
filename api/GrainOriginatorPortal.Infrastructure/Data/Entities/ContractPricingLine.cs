namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Represents a single pricing line for a contract.
/// Maps to base.vw_ContractPricing — one row per pricing record.
/// ContractId matches Contract.SourceContractId for client-side grouping.
/// </summary>
public class ContractPricingLine
{
    // Identifiers
    public string ContractId { get; set; } = string.Empty;     // SourceContractId — links to Contract.SourceContractId
    public string? ContractNumber { get; set; }
    public string? CustomerName { get; set; }

    // Pricing
    public int? PriceSequence { get; set; }
    public decimal? PriceQuantity { get; set; }
    public string? PriceUom { get; set; }
    public decimal? FlatPrice { get; set; }
    public decimal? BasisPrice { get; set; }
    public decimal? HedgePrice { get; set; }
    public DateTime? PriceDate { get; set; }
    public string? PriceCurrency { get; set; }

    // Trader
    public string? TraderInitials { get; set; }
    public string? Trader { get; set; }

    // Quantities
    public decimal? PriceOpenQuantity { get; set; }
    public decimal? PriceAppliedQuantity { get; set; }
    public decimal? PriceSettledQuantity { get; set; }
    public decimal? PriceOpenWeight { get; set; }
    public decimal? PriceAppliedWeight { get; set; }
    public decimal? PriceSettledWeight { get; set; }

    // Confirmation statuses
    public string? CustomerConfirmStatus { get; set; }
    public string? BrokerConfirmStatus { get; set; }
    public string? ConfirmationStatus { get; set; }

    // Dates
    public DateTime? CreatedDate { get; set; }
    public DateTime? ModifiedDate { get; set; }

    // -------------------------------------------------------------------------
    // Computed properties for frontend compatibility
    // -------------------------------------------------------------------------

    /// <summary>Quantity assigned a price on this pricing record — used by the frontend pricing status badge.</summary>
    public decimal? PricedQty => PriceQuantity;

    /// <summary>Flat/cash price — used by the frontend pricing badge when a single price exists.</summary>
    public decimal? CashPrice => FlatPrice;
}
