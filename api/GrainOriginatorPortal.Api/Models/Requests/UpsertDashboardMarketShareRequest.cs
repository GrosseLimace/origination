using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public class UpsertDashboardMarketShareRequest
{
    [Required]
    [StringLength(500)]
    public string TradeUnitKey { get; set; } = string.Empty;

    [Required]
    [StringLength(100)]
    public string CropCategory { get; set; } = string.Empty;

    [Range(2020, 2100)]
    public int PlantingYear { get; set; }

    public decimal? MarketSharePct { get; set; }
}
