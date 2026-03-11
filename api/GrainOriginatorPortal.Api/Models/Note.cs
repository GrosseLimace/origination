namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Represents a contact note or activity log entry for a customer.
/// Stored in Origination.dbo.Notes table (application-managed data).
/// </summary>
public class Note
{
    public int Id { get; set; }
    public long CustomerId { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string? CustomerCode { get; set; }
    public string? TradeUnit { get; set; }
    public string Description { get; set; } = string.Empty;
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime? ModifiedAt { get; set; }
    public bool IsPinned { get; set; }

    // Computed alias for frontend compatibility
    public string Content => Description;
}
