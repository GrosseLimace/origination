namespace GrainOriginatorPortal.Api.Models.Responses;

public class GeocodeResult
{
    public string Key { get; set; } = string.Empty;
    public double? Lat { get; set; }
    public double? Lng { get; set; }
}
