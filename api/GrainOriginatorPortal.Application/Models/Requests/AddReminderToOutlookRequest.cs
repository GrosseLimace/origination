using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>Body for "put this reminder on my Outlook calendar".
/// <para>Both fields come from the browser because the server cannot work them out: it does not know
/// where the user is sitting, and it does not know which host the SPA is being served from.</para></summary>
public record AddReminderToOutlookRequest
{
    /// <summary>The caller's IANA time zone, e.g. "America/Chicago". Graph wants a local literal
    /// plus a zone name, so without this the event lands at the wrong hour.</summary>
    [StringLength(100)]
    public string? TimeZone { get; init; }

    /// <summary>Absolute link back to the producer, put in the event body so the reminder is
    /// actionable straight from Outlook.</summary>
    [Required]
    [StringLength(500)]
    public required string ProducerLink { get; init; }
}
