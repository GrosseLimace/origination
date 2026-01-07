namespace GrainOriginatorPortal.Models;

/// <summary>
/// Represents a farm or field location associated with a customer.
/// </summary>
/// <remarks>
/// TODO: When connecting to real data:
/// - Add geospatial coordinates (latitude/longitude) for mapping
/// - Consider adding field boundaries (GeoJSON)
/// - Add soil type and FSA farm/tract numbers
/// - Add navigation property back to Customer
/// </remarks>
public class Farm
{
    /// <summary>
    /// Unique identifier for the farm.
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Name of the farm.
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Geographic location description.
    /// </summary>
    /// <remarks>TODO: Add structured address fields and coordinates</remarks>
    public string Location { get; set; } = string.Empty;

    /// <summary>
    /// Total acres in this farm operation.
    /// </summary>
    public int Acres { get; set; }

    /// <summary>
    /// On-farm bin storage capacity in bushels.
    /// </summary>
    public int? BinStorageCapacity { get; set; }
}