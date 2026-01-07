namespace GrainOriginatorPortal.Models;

/// <summary>
/// Represents a grain purchase contract with a customer.
/// </summary>
/// <remarks>
/// TODO: When connecting to real data:
/// - Link to actual contract management system
/// - Add audit fields (CreatedBy, CreatedDate, ModifiedBy, ModifiedDate)
/// - Consider adding contract terms, special conditions, and attachments
/// - Add navigation properties for Customer and Farm entities
/// </remarks>
public class Contract
{
    /// <summary>
    /// Unique identifier for the contract.
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Foreign key to the Customer entity.
    /// </summary>
    /// <remarks>TODO: Add navigation property: public virtual Customer Customer { get; set; }</remarks>
    public string CustomerId { get; set; } = string.Empty;

    /// <summary>
    /// Foreign key to the Farm entity where grain will be sourced.
    /// </summary>
    /// <remarks>TODO: Add navigation property: public virtual Farm Farm { get; set; }</remarks>
    public string FarmId { get; set; } = string.Empty;

    /// <summary>
    /// Human-readable contract number (e.g., "C001").
    /// </summary>
    public string ContractNumber { get; set; } = string.Empty;

    /// <summary>
    /// Type of commodity (e.g., "Corn", "Soybeans", "Wheat").
    /// </summary>
    /// <remarks>TODO: Consider using an enum or lookup table for standardized crop types</remarks>
    public string Crop { get; set; } = string.Empty;

    /// <summary>
    /// Contracted quantity in the specified unit.
    /// </summary>
    public int Quantity { get; set; }

    /// <summary>
    /// Unit of measure (e.g., "bushels", "tons").
    /// </summary>
    public string Unit { get; set; } = "bushels";

    /// <summary>
    /// Contract price per unit.
    /// </summary>
    public decimal Price { get; set; }

    /// <summary>
    /// Start of delivery window.
    /// </summary>
    public DateTime DeliveryStart { get; set; }

    /// <summary>
    /// End of delivery window.
    /// </summary>
    public DateTime DeliveryEnd { get; set; }

    /// <summary>
    /// Current status of the contract.
    /// </summary>
    public ContractStatus Status { get; set; } = ContractStatus.Pending;

    /// <summary>
    /// Indicates if the contract has been signed by all parties.
    /// </summary>
    /// <remarks>TODO: Consider tracking signature dates and who signed</remarks>
    public bool Signed { get; set; }
}