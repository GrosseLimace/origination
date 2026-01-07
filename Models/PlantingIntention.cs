namespace GrainOriginatorPortal.Models;

/// <summary>
/// Represents a customer's planned planting for an upcoming season.
/// </summary>
/// <remarks>
/// TODO: When connecting to real data:
/// - Add crop year field
/// - Link to seed variety database
/// - Consider adding expected harvest date
/// - Track actual vs planned for historical analysis
/// </remarks>
public class PlantingIntention
{
    /// <summary>
    /// Unique identifier for the planting intention.
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Foreign key to the Customer entity.
    /// </summary>
    public string CustomerId { get; set; } = string.Empty;

    /// <summary>
    /// Foreign key to the Farm entity.
    /// </summary>
    public string FarmId { get; set; } = string.Empty;

    /// <summary>
    /// Type of crop to be planted.
    /// </summary>
    public string Crop { get; set; } = string.Empty;

    /// <summary>
    /// Number of acres to be planted with this crop.
    /// </summary>
    public int Acres { get; set; }

    /// <summary>
    /// Seed variety name or code.
    /// </summary>
    public string Variety { get; set; } = string.Empty;

    /// <summary>
    /// Expected planting date.
    /// </summary>
    public DateTime PlantingDate { get; set; }

    /// <summary>
    /// Estimated yield in bushels per acre.
    /// </summary>
    /// <remarks>TODO: Consider using historical averages or APH data for more accurate estimates</remarks>
    public int EstimatedYield { get; set; }
}