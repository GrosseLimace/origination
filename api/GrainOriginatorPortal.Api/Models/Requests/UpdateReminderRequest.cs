using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record UpdateReminderRequest
{
    /// <summary>When the follow-up is due, in UTC.</summary>
    [Required]
    public required DateTime DueAt { get; init; }

    [StringLength(200)]
    public string? Subject { get; init; }

    [StringLength(2000)]
    public string? Notes { get; init; }

    /// <summary>The caller's IANA time zone (e.g. "America/Chicago"), sent by the browser.
    /// <para>Needed because rescheduling now moves the Outlook event server-side, and Graph wants a
    /// local literal plus a zone name. The server cannot infer where the user is sitting. Optional:
    /// absent means UTC, which only matters for a reminder that is already on a calendar.</para></summary>
    [StringLength(100)]
    public string? TimeZone { get; init; }
}
