namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Resolves the set of users who have access to THIS application — the members of the
/// per-environment Azure AD app-access group (configured via UsageDashboard:AppAccessGroupObjectId).
/// Used to limit the Usage Dashboard to real application users instead of everyone in the
/// (broad) trade-unit entitlements view.
/// </summary>
public interface IAppAccessUserService
{
    /// <summary>
    /// Returns the app-access group members as short-form user ids (UPN with any "@domain"
    /// stripped, e.g. "CEgr"), matching the key used in the entitlements/usage tables.
    /// Returns <c>null</c> when filtering is disabled (no group id configured) or the directory
    /// lookup fails — callers should treat <c>null</c> as "don't filter" (fail-open).
    /// </summary>
    Task<IReadOnlySet<string>?> GetAppAccessUserShortNamesAsync(CancellationToken cancellationToken = default);
}
