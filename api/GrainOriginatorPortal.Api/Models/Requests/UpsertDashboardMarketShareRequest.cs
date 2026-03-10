using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record UpsertDashboardMarketShareRequest
{
    [Required]
    [StringLength(500)]
    public required string TradeUnitKey { get; init; }

    [Required]
    [StringLength(100)]
    public required string CropCategory { get; init; }

    [Range(2020, 2100)]
    public int PlantingYear { get; init; }

    public decimal? MarketSharePct { get; init; }
}
