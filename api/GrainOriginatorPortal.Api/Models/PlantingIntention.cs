using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Represents a customer's planned planting for an upcoming season.
/// Stored in dbo.ProducerPlantingIntentions.
/// </summary>
public class PlantingIntention
{
    public int Id { get; set; }
    public long CustomerId { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string CustomerCode { get; set; } = string.Empty;
    public string TradeUnit { get; set; } = string.Empty;
    public int PlantingYear { get; set; }
    public string Crop { get; set; } = string.Empty;
    public string? Category { get; set; }
    public string? Type { get; set; }
    public string? Description { get; set; }
    public int Acres { get; set; }
    public DateTime CreatedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime? ModifiedAt { get; set; }
    public string? ModifiedBy { get; set; }

    // Navigation property — FK to dbo.Customer. Populated via Include() so the
    // service layer can copy CustomerName / CustomerCode onto the DTO without
    // those columns being stored on the ProducerPlantingIntentions table.
    // [JsonIgnore] keeps the nested Customer out of API responses.
    [JsonIgnore]
    public Customer? Customer { get; set; }
}
