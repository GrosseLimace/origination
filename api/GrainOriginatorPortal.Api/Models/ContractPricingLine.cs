namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Represents a single pricing line for a contract.
/// Maps to originations.vw_ContractPricing — one row per GNP009 pricing sequence,
/// or one row for flat/unpriced/deferred contracts that have no GNP009 records.
/// </summary>
public class ContractPricingLine
{
    // Identifiers
    public int PriceSequence { get; set; }
    public string ContractId { get; set; } = string.Empty;   // PrefixType+PrefixCode+ContractNo+Suffix (links to Contract.SourceContractId)
    public string DisplayId { get; set; } = string.Empty;

    // Reference
    public string? QuantityUom { get; set; }
    public string? CommodityCode { get; set; }
    public string PriceType { get; set; } = string.Empty;    // FLAT / PRICED / DEFERRED / UNPRICED / ERROR

    // Pricing
    public decimal? Adjustment { get; set; }
    public decimal? BasisPrice { get; set; }
    public decimal? CashPrice { get; set; }
    public decimal? FuturesPrice { get; set; }
    public string? FuturesMonth { get; set; }
    public string? Currency { get; set; }

    // Quantities
    public decimal? AppliedQty { get; set; }
    public decimal? PricedQty { get; set; }
    public decimal? ContractQty { get; set; }

    // Dates
    public DateTime? CreatedAt { get; set; }
    public DateTime? PricedAt { get; set; }
    public DateTime? DeliveryPeriodStart { get; set; }
    public DateTime? DeliveryPeriodEnd { get; set; }

    // Derived statuses (computed in view)
    public string SignatureStatus { get; set; } = string.Empty;   // Signed / Unsigned
    public string DeliveryStatus { get; set; } = string.Empty;    // Shipped / Partially Shipped / Not Shipped
    public string PricingStatus { get; set; } = string.Empty;     // Priced / Partially Priced / Not Priced

    // Location and org
    public string? LocationId { get; set; }
    public string? CompanyCode { get; set; }
    public string? DivisionCode { get; set; }
    public string? LocationCode { get; set; }

    // Key fields
    public int SequenceNumber { get; set; }
    public string? CustomerId { get; set; }
    public string? PrefixType { get; set; }
    public string? PrefixCode { get; set; }
    public string? ContractNumber { get; set; }
    public string? ContractSuffix { get; set; }
}
