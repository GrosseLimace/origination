namespace GrainOriginatorPortal.Api.Models;

public class UpsertDashboardActualHarvestRequest
{
    public string TradeUnitKey { get; set; } = string.Empty;
    public string CropCategory { get; set; } = string.Empty;
    public int PlantingYear { get; set; }
    public int Bushels { get; set; }
}
