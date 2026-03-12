using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record UpsertDashboardActualHarvestRequest
{
    [Required]
    [StringLength(500)]
    public string TradeUnitKey { get; init; } = string.Empty;

    [Required]
    [StringLength(100)]
    public string CropCategory { get; init; } = string.Empty;

    [Range(2020, 2100)]
    public int PlantingYear { get; init; }

    [Range(0, int.MaxValue)]
    public int Bushels { get; init; }
}
