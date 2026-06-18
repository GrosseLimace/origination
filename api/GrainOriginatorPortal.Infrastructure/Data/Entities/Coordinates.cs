namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Represents geographic coordinates for mapping purposes.
/// </summary>
public class Coordinates
{
    /// <summary>
    /// Latitude coordinate (north-south position).
    /// </summary>
    public double Lat { get; set; }

    /// <summary>
    /// Longitude coordinate (east-west position).
    /// </summary>
    public double Lng { get; set; }
}
