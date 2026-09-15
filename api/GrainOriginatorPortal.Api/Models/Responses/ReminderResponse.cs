namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// Wire shape for a personal producer follow-up reminder.
///
/// There is deliberately no owner field: the caller only ever receives their own reminders, so
/// naming the owner would be redundant on every row and would make it easy to start rendering an
/// author, which this feature does not have.
/// </summary>
public record ReminderResponse
{
    public int Id { get; init; }
    public long CustomerId { get; init; }
    public string CustomerName { get; init; } = string.Empty;
    public string? CustomerCode { get; init; }

    /// <summary>When the follow-up is due, in UTC.</summary>
    public DateTime DueAt { get; init; }

    public string Subject { get; init; } = string.Empty;
    public string? Notes { get; init; }

    /// <summary>Graph event id on the owner calendar; null means "not on Outlook yet".</summary>
    public string? OutlookEventId { get; init; }

    public bool IsCompleted { get; init; }
    public DateTime? CompletedAt { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime? ModifiedAt { get; init; }
}
