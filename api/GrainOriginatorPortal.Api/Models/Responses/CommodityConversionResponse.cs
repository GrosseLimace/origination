namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a commodity unit-conversion factor. Entity-shaped (Decision 1).</summary>
public record CommodityConversionResponse
{
    public string CommodityCode { get; init; } = string.Empty;
    public string? Description { get; init; }
    public decimal LbsPerUnit { get; init; }
    public string? UnitOfMeasure { get; init; }
}
