using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// A field on one crop row (planting intention) for a crop year, with its acres there. A field can sit on
/// more than one crop row in a year (double-cropping). Soft-deleted; a season holding a locked harvest
/// estimate can't be removed or have its acres changed.
/// </summary>
public class ProducerFieldSeason
{
    public int Id { get; set; }
    public int ProducerFieldId { get; set; }
    public int PlantingIntentionId { get; set; }
    public int CropYear { get; set; }
    /// <summary>The crop row's label when the field was put on it, e.g. "Irrigated Corn".</summary>
    public string CropLabel { get; set; } = string.Empty;
    public decimal? Acres { get; set; }
    public DateTime CreatedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime? ModifiedAt { get; set; }
    public string? ModifiedBy { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
    public string? DeletedBy { get; set; }

    [JsonIgnore]
    public ProducerField? Field { get; set; }
}
