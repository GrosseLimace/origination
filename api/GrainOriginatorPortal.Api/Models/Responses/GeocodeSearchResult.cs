namespace GrainOriginatorPortal.Api.Models.Responses;

public record GeocodeSearchResult
{
    public double Lat { get; init; }
    public double Lng { get; init; }
}
