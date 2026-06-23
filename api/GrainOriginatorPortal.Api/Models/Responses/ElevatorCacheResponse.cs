namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a cached elevator. Entity-shaped (Decision 1).</summary>
public record ElevatorCacheResponse
{
    public string ElevatorCode { get; init; } = "";
    public string? ElevatorShortName { get; init; }
    public string? ElevatorName { get; init; }
    public string? Address { get; init; }
    public string? City { get; init; }
    public string? State { get; init; }
    public string? ZipCode { get; init; }
    public string? OurFacility { get; init; }
    public string? TradeUnitCode { get; init; }
    public double? Latitude { get; init; }
    public double? Longitude { get; init; }
    public bool IsActive { get; init; } = true;
    public DateTime LastRefreshedAt { get; init; }
}
