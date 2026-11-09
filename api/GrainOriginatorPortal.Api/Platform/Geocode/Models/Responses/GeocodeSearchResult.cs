namespace GrainOriginatorPortal.Api.Platform.Geocode.Models.Responses;

public record GeocodeSearchResult
{
    public double Lat { get; init; }
    public double Lng { get; init; }
}
