namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// A user kept OUT of the Usage Dashboard analytics — e.g. IT / dev / admin accounts whose activity
/// would skew adoption numbers. Managed with plain SQL: add or remove a row to change the list, no
/// redeploy. This replaces the old hardcoded <c>UsageDashboard:ExcludeUsers</c> config list.
///
/// Usage-dashboard-ONLY: an excluded user keeps full app access and still appears everywhere else
/// (pickers, recaps, etc.); they're just dropped from the usage analytics. Keyed by short user name
/// (UPN before the '@', e.g. "CEgr"), matching the dashboard's user keys. Empty in dev/QA (so
/// developers still show there); populated in prod.
/// </summary>
public class UsageDashboardExcludedUser
{
    public int Id { get; set; }

    /// <summary>Short user name — UPN before the '@' (e.g. "CEgr"). The exclusion key; matched
    /// case-insensitively against the dashboard's user set. Unique.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Optional note on why this account is excluded (e.g. "IT admin", "test account").</summary>
    public string? Reason { get; set; }

    public DateTime CreatedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
}
