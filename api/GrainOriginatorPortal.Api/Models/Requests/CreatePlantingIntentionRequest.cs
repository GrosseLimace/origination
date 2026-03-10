using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public class CreatePlantingIntentionRequest
{
    [Required]
    public int CustomerId { get; set; }

    [Required]
    [StringLength(255)]
    public string CustomerName { get; set; } = string.Empty;

    [Required]
    [StringLength(50)]
    public string CustomerCode { get; set; } = string.Empty;

    [Required]
    [StringLength(100)]
    public string TradeUnit { get; set; } = string.Empty;

    [Required]
    [StringLength(100)]
    public string Crop { get; set; } = string.Empty;

    [StringLength(100)]
    public string? Type { get; set; }

    [StringLength(255)]
    public string? Description { get; set; }

    [Range(1, 100000)]
    public int Acres { get; set; }

    [Range(2020, 2100)]
    public int PlantingYear { get; set; }
}
