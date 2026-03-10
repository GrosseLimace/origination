using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record CreatePlantingIntentionRequest
{
    [Required]
    public required int CustomerId { get; init; }

    [Required]
    [StringLength(255)]
    public required string CustomerName { get; init; }

    [Required]
    [StringLength(50)]
    public required string CustomerCode { get; init; }

    [Required]
    [StringLength(100)]
    public required string TradeUnit { get; init; }

    [Required]
    [StringLength(100)]
    public required string Crop { get; init; }

    [StringLength(100)]
    public string? Type { get; init; }

    [StringLength(255)]
    public string? Description { get; init; }

    [Range(1, 100000)]
    public int Acres { get; init; }

    [Range(2020, 2100)]
    public int PlantingYear { get; init; }
}
