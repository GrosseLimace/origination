namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Represents a customer's planned planting for an upcoming season.
/// Stored in dbo.ProducerPlantingIntentions.
/// </summary>
public class PlantingIntention
{
    public int Id { get; set; }
    public int CustomerId { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string CustomerCode { get; set; } = string.Empty;
    public string TradeUnit { get; set; } = string.Empty;
    public int PlantingYear { get; set; }
    public string Crop { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int Acres { get; set; }
    public DateTime CreatedOn { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime? ModifiedOn { get; set; }
    public string? ModifiedBy { get; set; }
}
