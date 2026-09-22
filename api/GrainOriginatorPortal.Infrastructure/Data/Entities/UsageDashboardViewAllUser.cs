namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// A user allowed to read the WHOLE organisation on the Usage Dashboard and pick an arbitrary
/// manager from the manager dropdown. Managed with plain SQL: add or remove a row to change the
/// list, no redeploy and no App Service restart. This replaces the old hardcoded
/// <c>UsageDashboard:ViewAll</c> config array.
///
/// <para>
/// WHO CAN OPEN THE DASHBOARD AT ALL is a different question and is not stored here — that is
/// membership of the "Origination App {Env} Super Users" Entra group, which surfaces as the Admin
/// app role and is where managers and IT/admin alike are added. Everyone in that group who is NOT
/// in this table is auto-scoped to themselves plus everyone reporting to them, has the manager
/// dropdown hidden, and can only drill into users inside that subtree.
/// </para>
/// <para>
/// An EMPTY table therefore means "everyone is scoped", never "everyone sees everything" — the
/// fail-closed direction, which is what lets the reader degrade to empty when the DB is unreachable.
/// </para>
///
/// Keyed by short user name (UPN before the '@', e.g. "CEgr"), matching the dashboard's user keys.
/// </summary>
public class UsageDashboardViewAllUser
{
    public int Id { get; set; }

    /// <summary>Short user name — UPN before the '@' (e.g. "CEgr"). Matched case-insensitively
    /// against the caller's identity. Unique.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Optional note on why this person has whole-org access (e.g. "Ops leadership").</summary>
    public string? Reason { get; set; }

    public DateTime CreatedAt { get; set; }

    /// <summary>Who granted the access — an audit trail for a row that widens what someone can see.
    /// Set it by hand when adding a row via SQL; defaults to 'system'.</summary>
    public string CreatedBy { get; set; } = string.Empty;
}
