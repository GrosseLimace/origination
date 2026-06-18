namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a commodity reference row. Entity-shaped (Decision 1).</summary>
public record CommodityResponse
{
    public int Id { get; init; }
    public string Code { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string? Category { get; init; }
    public string? Tier1 { get; init; }
    public string? Tier2 { get; init; }
    public string? Tier3 { get; init; }
    public string? BaseUOM { get; init; }
    public bool IsActive { get; init; } = true;
    public bool ShowInPlantingIntentions { get; init; }
}
