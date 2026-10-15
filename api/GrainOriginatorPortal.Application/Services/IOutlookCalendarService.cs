namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Writes producer follow-up reminders to the CALLING USER's own Outlook calendar, via Microsoft
/// Graph on-behalf-of them.
/// <para>
/// <b>Nothing here ever throws.</b> A calendar write is a best-effort mirror of a reminder that is
/// already saved: if consent is missing, the token exchange fails, or Graph is down, the reminder
/// must still stand. Failures come back as null / false and the row offers an "Add to Outlook" retry.
/// </para>
/// </summary>
public interface IOutlookCalendarService
{
    /// <summary>Creates the event and returns its Graph id, or null when it could not be written.</summary>
    Task<string?> CreateEventAsync(OutlookEventRequest request, CancellationToken cancellationToken);

    /// <summary>Moves an existing event to a new window. Returns false when it could not be moved.</summary>
    Task<bool> UpdateEventWindowAsync(string eventId, DateTime dueAtUtc, string timeZone, CancellationToken cancellationToken);

    /// <summary>Removes the event. An event already gone counts as success — the end state is the same.</summary>
    Task<bool> DeleteEventAsync(string eventId, CancellationToken cancellationToken);
}

/// <summary>Everything needed to write one follow-up to a calendar.</summary>
public record OutlookEventRequest
{
    public required string Subject { get; init; }
    public required string CustomerName { get; init; }
    public string? Notes { get; init; }

    /// <summary>Due time in UTC, as stored.</summary>
    public required DateTime DueAtUtc { get; init; }

    /// <summary>The caller's IANA time zone, supplied by the browser.
    /// <para>Load-bearing: Graph wants an UNZONED local literal plus a separate zone name, and the
    /// server has no idea where the user is sitting. Without this the event would land at the wrong
    /// hour for anyone outside the server's zone.</para></summary>
    public required string TimeZone { get; init; }

    /// <summary>Deep link back to the producer, put in the event body.</summary>
    public required string ProducerLink { get; init; }
}
