namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Represents a contact note or activity log entry for a customer.
/// </summary>
public class Note
{
    public string Id { get; set; } = string.Empty;
    public string CustomerId { get; set; } = string.Empty;
    public string? FarmId { get; set; }
    public string OriginatorName { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; }
    public string Content { get; set; } = string.Empty;
    public bool Pinned { get; set; }
}
