namespace GrainOriginatorPortal.Models;

/// <summary>
/// Represents a contact note or activity log entry for a customer.
/// </summary>
/// <remarks>
/// TODO: When connecting to real data:
/// - Integrate with CRM activity tracking
/// - Add activity type (call, email, visit, etc.)
/// - Consider adding follow-up date and reminder functionality
/// - Link OriginatorName to User/Employee entity
/// </remarks>
public class Note
{
    /// <summary>
    /// Unique identifier for the note.
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Foreign key to the Customer entity.
    /// </summary>
    public string CustomerId { get; set; } = string.Empty;

    /// <summary>
    /// Foreign key to the Farm entity (optional, for farm-specific notes).
    /// </summary>
    public string? FarmId { get; set; }

    /// <summary>
    /// Name of the originator who created the note.
    /// </summary>
    /// <remarks>TODO: Replace with foreign key to User/Employee entity</remarks>
    public string OriginatorName { get; set; } = string.Empty;

    /// <summary>
    /// When the note was created.
    /// </summary>
    public DateTime Timestamp { get; set; }

    /// <summary>
    /// The note content.
    /// </summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>
    /// Indicates if this note is pinned for priority visibility.
    /// </summary>
    public bool Pinned { get; set; }
}