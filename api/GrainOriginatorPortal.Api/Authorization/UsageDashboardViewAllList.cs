namespace GrainOriginatorPortal.Api.Authorization;

/// <summary>
/// The <c>UsageDashboard:ViewAll</c> short names, resolved once at startup and injected where the
/// scoping decision is made.
/// <para>
/// A wrapper record rather than raw <c>string[]</c> so it can be registered and resolved by DI
/// without colliding with every other string array, and so <see cref="UsageDashboardService"/> stays
/// unit-testable without standing up an <c>IConfiguration</c>. Read at startup because the list is
/// operator-managed config, not per-request state — changing it is an App Service restart, same as
/// the Viewers list next to it.
/// </para>
/// </summary>
/// <param name="ShortNames">UPN local parts (e.g. "CEgr"), matched case-insensitively.</param>
public sealed record UsageDashboardViewAllList(IReadOnlyCollection<string> ShortNames)
{
    /// <summary>Empty list — nobody sees the whole org. Used by tests that only exercise scoping.</summary>
    public static readonly UsageDashboardViewAllList Empty = new([]);
}
