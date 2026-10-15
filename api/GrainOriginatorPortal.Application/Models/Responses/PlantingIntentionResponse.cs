namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a planting intention. Entity-shaped (Decision 1) minus the JSON-ignored
/// Customer navigation; CreatedBy/ModifiedBy are resolved to display names.</summary>
public record PlantingIntentionResponse
{
    public int Id { get; init; }
    public long CustomerId { get; init; }
    public string CustomerName { get; init; } = string.Empty;
    public string CustomerCode { get; init; } = string.Empty;
    public string TradeUnit { get; init; } = string.Empty;
    public int PlantingYear { get; init; }
    public string Crop { get; init; } = string.Empty;
    public string? Category { get; init; }
    public string? Type { get; init; }
    public string? Description { get; init; }
    public int Acres { get; init; }
    public DateTime CreatedAt { get; init; }
    public string CreatedBy { get; init; } = string.Empty;
    public DateTime? ModifiedAt { get; init; }
    public string? ModifiedBy { get; init; }
}
