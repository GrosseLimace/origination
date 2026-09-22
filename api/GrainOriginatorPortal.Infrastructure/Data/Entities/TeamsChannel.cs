namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// A Microsoft Teams channel someone has made @-mentionable, registered the first time it is picked
/// from the note composer's "@" menu.
/// <para>
/// This is a REGISTRY, not a group of people: it has no members, no recap, and no visibility rules —
/// anyone may mention any registered channel. It is deliberately a separate table from
/// <see cref="DailyRecapGroup"/>, which is a set of recipients with per-creator visibility; conflating
/// the two would either hide a colleague's channel from the picker or fill everyone's Manage Groups
/// page with every channel in the company.
/// </para>
/// <para>
/// The note stores only this row's <see cref="Id"/>, never <see cref="ChannelEmail"/>. The Instant
/// Share Note Logic App re-reads the address here at send time, so a user-authored address can never
/// reach the shared mailbox (the property M-025 / M-025a established for person recipients).
/// </para>
/// </summary>
public class TeamsChannel
{
    public int Id { get; set; }

    /// <summary>Entra group id of the team the channel belongs to. Stored for provenance and to
    /// re-resolve the channel if its name changes; never used as a send target.</summary>
    public string TeamId { get; set; } = string.Empty;

    /// <summary>Team display name, shown in the picker so two channels called "General" are
    /// distinguishable.</summary>
    public string TeamName { get; set; } = string.Empty;

    /// <summary>Graph channel id. Unique per channel and the natural registry key.</summary>
    public string ChannelId { get; set; } = string.Empty;

    /// <summary>Channel display name, e.g. "Grain Desk".</summary>
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>The channel's "send to channel" address. Validated to be a Scoular-tenant Teams
    /// address on registration and re-checked by the workflow before every send.</summary>
    public string ChannelEmail { get; set; } = string.Empty;

    /// <summary>Who first registered it. Audit only — it confers no ownership, because a registered
    /// channel is mentionable by everyone.</summary>
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}
