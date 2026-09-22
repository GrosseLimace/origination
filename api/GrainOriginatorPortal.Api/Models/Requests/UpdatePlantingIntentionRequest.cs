using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record UpdatePlantingIntentionRequest
{
    [Required]
    [StringLength(100)]
    public required string Crop { get; init; }

    [StringLength(100)]
    public string? Category { get; init; }

    [StringLength(100)]
    public string? Type { get; init; }

    [StringLength(255)]
    public string? Description { get; init; }

    [Range(1, 100000)]
    public int Acres { get; init; }

    [Range(2020, 2100)]
    public int PlantingYear { get; init; }

    /// <summary>Optional. Null/blank leaves the stored trade unit unchanged; a value must be one of
    /// the producer's active trade units (validated server-side, 400 otherwise).</summary>
    [StringLength(100)]
    public string? TradeUnit { get; init; }
}
