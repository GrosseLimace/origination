namespace GrainOriginatorPortal.Models;

/// <summary>
/// Represents a customer (farmer/producer) in the grain origination system.
/// </summary>
/// <remarks>
/// TODO: When connecting to real data:
/// - Map to your CRM or customer database table
/// - FarmIds should reference the actual Farm entity relationships
/// - TotalAcres may be calculated server-side or stored as denormalized data
/// - Add audit fields (CreatedDate, ModifiedDate, CreatedBy, ModifiedBy)
/// </remarks>
public class Customer
{
    /// <summary>
    /// Unique identifier for the customer.
    /// </summary>
    /// <remarks>TODO: Replace with actual database primary key (GUID or int)</remarks>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Full name of the customer or business entity.
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Primary farm name associated with this customer.
    /// </summary>
    /// <remarks>TODO: Consider making this a navigation property to Farm entity</remarks>
    public string Farm { get; set; } = string.Empty;

    /// <summary>
    /// Geographic location (County, State format).
    /// </summary>
    /// <remarks>TODO: Consider splitting into separate County and State fields for better filtering</remarks>
    public string Location { get; set; } = string.Empty;

    /// <summary>
    /// Primary contact phone number.
    /// </summary>
    public string Phone { get; set; } = string.Empty;

    /// <summary>
    /// Primary contact email address.
    /// </summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>
    /// Total acres across all associated farms.
    /// </summary>
    /// <remarks>TODO: This should be calculated from sum of Farm.Acres or stored as computed column</remarks>
    public int TotalAcres { get; set; }

    /// <summary>
    /// List of farm IDs associated with this customer.
    /// </summary>
    /// <remarks>TODO: Replace with proper EF Core navigation property: public virtual ICollection&lt;Farm&gt; Farms { get; set; }</remarks>
    public List<string> FarmIds { get; set; } = new();

    /// <summary>
    /// Indicates if customer has enabled electronic signature capability.
    /// </summary>
    public bool ESignEnabled { get; set; }

    /// <summary>
    /// Geographic coordinates for mapping customer location.
    /// </summary>
    /// <remarks>TODO: Populate from geocoding service or customer address data</remarks>
    public Coordinates? Coordinates { get; set; }
}