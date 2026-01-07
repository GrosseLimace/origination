namespace GrainOriginatorPortal.Models;

/// <summary>
/// Represents a delivery ticket for grain received at a facility.
/// </summary>
/// <remarks>
/// TODO: When connecting to real data:
/// - Integrate with scale ticket system
/// - Add quality metrics (damage, foreign material)
/// - Add facility/location information
/// - Consider adding driver and truck information
/// - Link to associated Contract (some deliveries may be spot sales without contracts)
/// </remarks>
public class Ticket
{
    /// <summary>
    /// Unique identifier for the ticket.
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
    /// Date and time of delivery.
    /// </summary>
    public DateTime Date { get; set; }

    /// <summary>
    /// Type of commodity delivered.
    /// </summary>
    public string Crop { get; set; } = string.Empty;

    /// <summary>
    /// Gross weight as measured at scale (pounds).
    /// </summary>
    public int GrossWeight { get; set; }

    /// <summary>
    /// Tare weight (truck weight empty, in pounds).
    /// </summary>
    public int TareWeight { get; set; }

    /// <summary>
    /// Net weight (Gross - Tare, in pounds).
    /// </summary>
    /// <remarks>TODO: This could be a computed property: GrossWeight - TareWeight</remarks>
    public int NetWeight { get; set; }

    /// <summary>
    /// Moisture content percentage at delivery.
    /// </summary>
    /// <remarks>TODO: Add discounts/premiums based on moisture deviation from base</remarks>
    public decimal Moisture { get; set; }

    /// <summary>
    /// Test weight in pounds per bushel.
    /// </summary>
    /// <remarks>Standard test weights: Corn 56 lb/bu, Soybeans 60 lb/bu, Wheat 60 lb/bu</remarks>
    public decimal TestWeight { get; set; }
}