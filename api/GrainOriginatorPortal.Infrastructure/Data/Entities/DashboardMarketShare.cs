namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

public class DashboardMarketShare
{
    public int Id { get; set; }
    public string TradeUnitKey { get; set; } = string.Empty;
    public string CropCategory { get; set; } = string.Empty;
    public int PlantingYear { get; set; }
    public decimal? MarketSharePct { get; set; }
    public DateTime CreatedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime? ModifiedAt { get; set; }
    public string? ModifiedBy { get; set; }
}
