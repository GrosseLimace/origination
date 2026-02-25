namespace GrainOriginatorPortal.Api.Models;

public class UpsertDashboardEstimateRequest
{
    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(500)]
    public string TradeUnitKey { get; set; } = string.Empty;

    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(100)]
    public string Crop { get; set; } = string.Empty;

    [System.ComponentModel.DataAnnotations.Range(2020, 2100)]
    public int PlantingYear { get; set; }

    public decimal? YieldEstimate { get; set; }
    public decimal? MarketSharePct { get; set; }
    public long? ActualHarvestHandle { get; set; }
}
