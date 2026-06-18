namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// Wire shape for a customer-storage (warehouse-receipt) grain row. Entity-shaped (Decision 1),
/// including the entity's computed Bushels / DateReceived so the SPA contract is unchanged.
/// </summary>
public record StoredGrainResponse
{
    public string Id { get; init; } = string.Empty;
    public string ReceiptNumber { get; init; } = string.Empty;
    public long CustomerId { get; init; }
    public string CustomerCode { get; init; } = string.Empty;
    public string Crop { get; init; } = string.Empty;
    public decimal Quantity { get; init; }
    public decimal GrossQuantity { get; init; }
    public DateTime StorageStartDate { get; init; }
    public decimal StorageRate { get; init; }
    public string Bin { get; init; } = string.Empty;
    public decimal ReceivableAmount { get; init; }
    public decimal StorageDays { get; init; }
    public DateTime? ChargedFromDate { get; init; }
    public DateTime? ChargedThruDate { get; init; }
    public decimal Bushels { get; init; }
    public DateTime DateReceived { get; init; }
}
