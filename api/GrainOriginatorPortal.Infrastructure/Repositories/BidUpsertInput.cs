namespace GrainOriginatorPortal.Infrastructure.Repositories;

/// <summary>
/// Layer-neutral input for a bulk bid upsert. The Api request DTO is mapped onto this so the
/// repository never references the Api layer. A location is matched by (ElevatorCode) or (Name)
/// within the trade unit; an empty <see cref="Bid"/> means "clear this bid" (delete the row).
/// </summary>
public record BidUpsertInput
{
    public string? Name { get; init; }
    public string? ElevatorCode { get; init; }
    public string? GroupName { get; init; }
    public double? Latitude { get; init; }
    public double? Longitude { get; init; }
    public string CommodityCode { get; init; } = string.Empty;
    public string? CommodityName { get; init; }
    public string? CommodityCategory { get; init; }
    public int CropYear { get; init; }
    public int Month { get; init; }
    public string Bid { get; init; } = string.Empty;
}
