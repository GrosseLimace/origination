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

    // Customer info (denormalized in ODS)
    public string? CustomerName { get; set; }

    // Commodity information
    public string? CommodityCode { get; set; }
    public string? CommodityDescription { get; set; }
    public string? CommodityGroup { get; set; }

    // Quantity and pricing
    public decimal? Quantity { get; set; }
    public decimal? Weight { get; set; }
    public string? Unit { get; set; }
    public decimal? Price { get; set; } // Calculated: TotalValue / Quantity
    public decimal? TotalValue { get; set; } // Total contract value from ODS

    // Dates
    public DateTime? ContractDate { get; set; }
    public DateTime? DeliveryStart { get; set; } // Maps to StartShipDate
    public DateTime? DeliveryEnd { get; set; } // Maps to FinalShipDate
    public DateTime? ClosedDate { get; set; }

    // Status
    public ContractStatus Status { get; set; } = ContractStatus.Pending;
    public bool Signed { get; set; }

    // ODS metadata fields
    public bool IsActive { get; set; }
    public DateTime? EffectiveStartDate { get; set; }
    public DateTime? EffectiveEndDate { get; set; }
}
