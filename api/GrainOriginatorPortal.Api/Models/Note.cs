namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Represents a contact note or activity log entry for a customer.
/// Stored in Origination.dbo.Notes table (application-managed data).
/// </summary>
public class Note
{
    public long Id { get; set; }
    public long CustomerId { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string? TradeUnit { get; set; }
    public string Description { get; set; } = string.Empty;
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedOn { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime? ModifiedOn { get; set; }
    public bool IsPinned { get; set; }

    // Computed properties for backward compatibility with frontend
    public DateTime CreatedAt => CreatedOn; // Alias for frontend compatibility
    public string Content => Description; // Alias for frontend compatibility
}
