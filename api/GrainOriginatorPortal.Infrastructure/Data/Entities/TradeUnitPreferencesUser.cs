namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Read-only projection of dbo.Users in the TradeUnitPreferences database — the roster the
/// trade-unit preferences application owns. This app only reads it.
///
/// Mapped so note mentions can be checked against a real identity before they are persisted: the
/// Instant Share Note Logic App resolves a person mention by testing it against this same table
/// (<c>Get_Active_Users</c>, filtered <c>IsActive eq 1</c>) and then mails the note from the shared
/// mailbox, so a mention that never matches here can only ever be a forged id.
/// </summary>
public class TradeUnitPreferencesUser
{
    /// <summary>UPN prefix (e.g. "CEgr"), not the full UPN — the same convention as
    /// <see cref="UserTradeUnitPreference.UserId"/>.</summary>
    public string UserId { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    /// <summary>Cleared when someone leaves or is off-boarded. The Logic App skips inactive
    /// recipients at send time, so a mention of one would notify nobody.</summary>
    public bool IsActive { get; set; }
}
