namespace GrainOriginatorPortal.Api.Models.Requests;

public class GeocodeRequest
{
    public string Key { get; set; } = string.Empty;
    public string? Street { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? Zip { get; set; }
}
