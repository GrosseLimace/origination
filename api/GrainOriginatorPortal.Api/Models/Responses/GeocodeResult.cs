namespace GrainOriginatorPortal.Api.Models.Responses;

public record GeocodeResult
{
    public string Key { get; init; } = string.Empty;
    public double? Lat { get; init; }
    public double? Lng { get; init; }
}
