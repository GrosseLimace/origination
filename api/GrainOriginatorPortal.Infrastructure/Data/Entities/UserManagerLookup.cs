namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Read-only projection of dbo.vw_UserManagerLookup in the TradeUnitPreferences database:
/// one row per AD-synced user with their position in the org hierarchy.
///
/// HierID is a materialized path of dot-separated two-digit segments ("01.11.02.05.09");
/// a manager's HierID is always a prefix of every subtree member's HierID, so "everyone
/// under manager X" is a StartsWith(managerHier + ".") test. The view derives the manager
/// by stripping the last segment and requires the parent to be active, which means
/// ManagerUserId is null for the root and for orphans whose parent is inactive. The view
/// does not expose IsActive, so inactive users appear as ordinary rows.
/// </summary>
public class UserManagerLookup
{
    /// <summary>UPN prefix (e.g. "CEgr") — the same identity key the usage dashboard uses.
    /// Casing varies in the data, so compare case-insensitively.</summary>
    public string UserId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? HierId { get; set; }
    public bool IsManager { get; set; }
    public string? ManagerUserId { get; set; }
    public string? ManagerDisplayName { get; set; }
    public string? ManagerHierId { get; set; }
}
