namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a saved customer list. Entity-shaped (Decision 1); CreatedBy/ModifiedBy
/// are resolved to display names by the service.</summary>
public record SavedListResponse
{
    public int Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public string Query { get; init; } = string.Empty;
    public string? TradeUnits { get; init; }
    public string? Filters { get; init; }
    public string? IncludedCustomerIds { get; init; }
    public string? ExcludedCustomerIds { get; init; }
    public string CreatedBy { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public DateTime? ModifiedAt { get; init; }
    public string? ModifiedBy { get; init; }
    public bool IsActive { get; init; } = true;
}
