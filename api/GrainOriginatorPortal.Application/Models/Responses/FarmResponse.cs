namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a farm / field location. Entity-shaped (Decision 1).</summary>
public record FarmResponse
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Location { get; init; } = string.Empty;
    public int Acres { get; init; }
    public int? BinStorageCapacity { get; init; }
}
