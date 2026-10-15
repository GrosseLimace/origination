namespace GrainOriginatorPortal.Mobile.Contracts;

/// <summary>Schema <c>Commodity</c>: crops selectable when adding a planting intention (card #647).</summary>
public sealed record CommodityDto
{
    public required string Code { get; init; }
    public required string Name { get; init; }
    public string? PlantingCategory { get; init; }
}
