namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// The set of short names allowed to read the WHOLE organisation on the Usage Dashboard and pick an
/// arbitrary manager. Sourced from <c>dbo.UsageDashboardViewAllUsers</c> so the list can be changed
/// with a plain SQL INSERT/DELETE — no redeploy, no App Service restart.
/// </summary>
public interface IUsageDashboardViewAllProvider
{
    /// <summary>The current list, cached briefly. Never null; an empty set means everyone is scoped
    /// to their own subtree, which is the safe direction and also what a DB outage degrades to.</summary>
    Task<IReadOnlyCollection<string>> GetAsync(CancellationToken cancellationToken);
}
