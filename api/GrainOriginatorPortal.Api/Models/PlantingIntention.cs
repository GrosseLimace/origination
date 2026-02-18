namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Represents a customer's planned planting for an upcoming season.
/// </summary>
public class PlantingIntention
{
    public string Id { get; set; } = string.Empty;
    public string CustomerId { get; set; } = string.Empty;
    public string FarmId { get; set; } = string.Empty;
    public string Crop { get; set; } = string.Empty;
    public int Acres { get; set; }
    public string Variety { get; set; } = string.Empty;
    public int PlantingYear { get; set; }
    public int EstimatedYield { get; set; }
}
