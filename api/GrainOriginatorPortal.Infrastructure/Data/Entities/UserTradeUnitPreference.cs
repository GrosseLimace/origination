namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Read-only projection of dbo.vw_UserTradeUnitPreferences in the TradeUnitPreferences database.
/// Represents a single trade unit assignment for a user (direct assignment or group membership).
///
/// Replaced the Entitlements DB's vw_UserTradeUnitAccess (2026-08-18). Managers now assign users to
/// trade units in the trade-unit preferences application, which owns the writes; this app only reads.
/// The column set is identical to the old view, which is why the swap touched no query logic.
/// </summary>
public class UserTradeUnitPreference
{
    /// <summary>UPN prefix (e.g. "CEgr"), not the full UPN — same convention as the old view.</summary>
    public string UserId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string TradeUnitCode { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? AssignmentSource { get; set; }
    public int? GroupId { get; set; }
    public string? GroupName { get; set; }
}
