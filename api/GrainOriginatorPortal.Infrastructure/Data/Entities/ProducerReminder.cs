using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// A personal follow-up reminder an originator sets against a producer ("call Smith Farms on the
/// 14th"). Stored in Origination.dbo.ProducerReminders (application-managed data).
///
/// Reminders are STRICTLY PERSONAL: every read and write is filtered on <see cref="CreatedBy"/>,
/// so a user only ever sees their own. This is deliberately stricter than Notes, which are shared
/// across the team (see SECURITY-REVIEWS/ACCEPTED-RISKS.md AR-01/AR-02) — a reminder is a private
/// to-do, not a shared record of contact.
///
/// <see cref="OutlookEventId"/> holds the Microsoft Graph event id when the user's browser also put
/// the reminder on their own Outlook calendar. It is null when the calendar write was skipped or
/// failed, which is what drives the "Add to Outlook" retry affordance in the UI.
/// </summary>
public class ProducerReminder
{
    public int Id { get; set; }
    public long CustomerId { get; set; }

    /// <summary>When the follow-up is due, in UTC.</summary>
    public DateTime DueAt { get; set; }

    public string Subject { get; set; } = string.Empty;
    public string? Notes { get; set; }

    /// <summary>Graph event id on the owner's own calendar; null when not (yet) synced.</summary>
    public string? OutlookEventId { get; set; }

    public bool IsCompleted { get; set; }
    public DateTime? CompletedAt { get; set; }

    /// <summary>Owner UPN. The one and only access-control key for this row.</summary>
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? ModifiedAt { get; set; }

    // Denormalized producer identity for the API response. NOT stored on the table — the same
    // Phase 3b decision as Notes: composed from the Customer FK join on read so a producer rename
    // can never leave a stale copy behind.
    public string CustomerName { get; set; } = string.Empty;
    public string? CustomerCode { get; set; }

    // Navigation property — FK to dbo.Customer. [JsonIgnore] keeps the nested Customer out of API
    // responses; the flat CustomerName / CustomerCode properties carry the producer info.
    [JsonIgnore]
    public Customer? Customer { get; set; }
}
