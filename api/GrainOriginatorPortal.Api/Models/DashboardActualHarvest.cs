namespace GrainOriginatorPortal.Api.Models;

public class DashboardActualHarvest
{
    public int Id { get; set; }
    public string TradeUnitKey { get; set; } = string.Empty;
    public string CropCategory { get; set; } = string.Empty;
    public int PlantingYear { get; set; }
    public int Bushels { get; set; }
    public DateTime CreatedOn { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime? ModifiedOn { get; set; }
    public string? ModifiedBy { get; set; }
}
