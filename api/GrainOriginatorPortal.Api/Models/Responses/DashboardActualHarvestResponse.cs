namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a dashboard actual-harvest row. Entity-shaped (Decision 1).</summary>
public record DashboardActualHarvestResponse
{
    public int Id { get; init; }
    public string TradeUnitKey { get; init; } = string.Empty;
    public string CropCategory { get; init; } = string.Empty;
    public int PlantingYear { get; init; }
    public int Bushels { get; init; }
    public DateTime CreatedAt { get; init; }
    public string CreatedBy { get; init; } = string.Empty;
    public DateTime? ModifiedAt { get; init; }
    public string? ModifiedBy { get; init; }
}
