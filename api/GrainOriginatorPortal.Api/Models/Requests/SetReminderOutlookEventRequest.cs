using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>
/// Links a reminder to the Outlook event the user browser just created on their own calendar, or
/// clears the link when the event is gone. Kept as its own endpoint and its own request type so the
/// event id can never be set through a general edit: it is bookkeeping the client reports back,
/// not a field the user types.
/// </summary>
public record SetReminderOutlookEventRequest
{
    /// <summary>Microsoft Graph event id; null clears the link.</summary>
    [StringLength(256)]
    public string? OutlookEventId { get; init; }
}
