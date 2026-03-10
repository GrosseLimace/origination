using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public class UpdatePlantingIntentionRequest
{
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
