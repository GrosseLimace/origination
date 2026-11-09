namespace GrainOriginatorPortal.Api.Modules.Customers.Models.Responses;

/// <summary>Wire shape for geographic coordinates. Entity-shaped (Decision 1).</summary>
public record CoordinatesResponse
{
    public double Lat { get; init; }
    public double Lng { get; init; }
}
