namespace GrainOriginatorPortal.Api.Models.Requests;

public record UpsertDashboardActualHarvestRequest
{
    public string TradeUnitKey { get; init; } = string.Empty;
    public string CropCategory { get; init; } = string.Empty;
    public int PlantingYear { get; init; }
    public int Bushels { get; init; }
}
