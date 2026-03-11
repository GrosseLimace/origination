namespace GrainOriginatorPortal.Api.Models.Requests;

public record GeocodeRequest
{
    public string Key { get; init; } = string.Empty;
    public string? Street { get; init; }
    public string? City { get; init; }
    public string? State { get; init; }
    public string? Zip { get; init; }
}
