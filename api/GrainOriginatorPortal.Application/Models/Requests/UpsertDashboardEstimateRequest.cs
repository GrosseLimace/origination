using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record UpsertDashboardEstimateRequest
{
    [Required]
    [StringLength(500)]
    public required string TradeUnitKey { get; init; }

    [Required]
    [StringLength(100)]
    public required string Crop { get; init; }

    [Range(2020, 2100)]
    public int PlantingYear { get; init; }

    [Range(0, 1000)]
    public decimal? YieldEstimate { get; init; }
}
