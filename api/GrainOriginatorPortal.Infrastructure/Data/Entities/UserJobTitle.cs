namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// The job title most recently seen on a user's access token — the Entra <c>jobTitle</c> claim —
/// one row per user. Written by the usage-tracking pipeline (see
/// <c>UsageTrackingMiddleware</c> → <c>JobTitleChangeTracker</c>), read by the usage dashboard's
/// job-title filter and the per-user drill-down.
///
/// <para>
/// This is the LATEST title, not a history: the dashboard filters on who someone is today, and a
/// per-event title would bloat the activity tables for a question nobody asks. The claim reflects
/// the directory at sign-in, so a title change shows up with the person's next sign-in.
/// </para>
/// <para>
/// A user who has never signed in since this shipped has no row — the token claim is the only
/// source, because the app's managed identity cannot read job titles from Graph. The dashboard
/// treats a missing row and a NULL title the same way: "No title".
/// </para>
/// </summary>
public class UserJobTitle
{
    /// <summary>Short user name — UPN before the '@' (e.g. "CEgr"), matching every other usage table.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>NULL when the token carried no <c>jobTitle</c> claim (no title in the directory).
    /// IT's guidance is to treat that as "no title", never as an error.</summary>
    public string? JobTitle { get; set; }

    /// <summary>When the current <see cref="JobTitle"/> value was first observed. Not touched by
    /// later requests that carry the same title, so it is cheap to keep current.</summary>
    public DateTime RecordedAt { get; set; }
}
