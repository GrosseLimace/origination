using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Extensions.Caching.Memory;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Reads the whole-org viewer list from <c>dbo.UsageDashboardViewAllUsers</c>.
///
/// <para>
/// WHO MAY OPEN THE DASHBOARD is a separate question answered by the Admin app role, which arrives
/// via the "Origination App {Env} Super Users" Entra group — managers and IT/admin alike are added
/// there. This list answers HOW MUCH they see. Deliberately not derived from the Admin role: that
/// role only says "may open this", and every name on this list already holds Admin in QA and PROD
/// through those groups, so an Admin-implies-view-all rule would leave nobody scoped in the only
/// environments that matter.
/// </para>
/// <para>
/// Previously the <c>UsageDashboard:ViewAll</c> config array, which meant a deploy and a restart per
/// change. Now a table, so adding or removing someone is one SQL statement that takes effect within
/// <see cref="SuccessTtl"/>. The TTL is deliberately short for exactly that reason — there is no
/// app-side invalidation hook, because the list is edited outside the app.
/// </para>
/// </summary>
public class UsageDashboardViewAllProvider : IUsageDashboardViewAllProvider
{
    private const string CacheKey = "usage-dash:view-all";
    private const string FailureCacheKey = "usage-dash:view-all:failed";

    /// <summary>Short, because a SQL edit is the only way this list changes and the whole point of
    /// moving it out of config was that a change lands without a restart. The read is a handful of
    /// rows from a table with a unique index, so re-reading every minute costs nothing.</summary>
    private static readonly TimeSpan SuccessTtl = TimeSpan.FromSeconds(60);

    /// <summary>A recent failure short-circuits further reads so one dashboard page load
    /// (~10 endpoints) hitting a down DB produces one connection timeout, not ten.</summary>
    private static readonly TimeSpan FailureTtl = TimeSpan.FromSeconds(30);

    private static readonly IReadOnlyCollection<string> None =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    private readonly IUsageRepository _repo;
    private readonly IMemoryCache _cache;
    private readonly ILogger<UsageDashboardViewAllProvider> _logger;

    public UsageDashboardViewAllProvider(
        IUsageRepository repo,
        IMemoryCache cache,
        ILogger<UsageDashboardViewAllProvider> logger)
    {
        _repo = repo;
        _cache = cache;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyCollection<string>> GetAsync(CancellationToken cancellationToken)
    {
        if (_cache.TryGetValue(CacheKey, out IReadOnlyCollection<string>? cached) && cached is not null)
            return cached;
        if (_cache.TryGetValue(FailureCacheKey, out bool _))
            return None;

        try
        {
            var ids = await _repo.GetViewAllUserIdsAsync(cancellationToken);
            // Short names vary in casing at the source (e.g. "jpiittmann" / "JPiittmann"), so the
            // set itself carries the comparer rather than relying on every caller to remember.
            IReadOnlyCollection<string> set = new HashSet<string>(ids, StringComparer.OrdinalIgnoreCase);

            // The shared IMemoryCache is registered with a SizeLimit, so every entry declares a size.
            _cache.Set(CacheKey, set, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = SuccessTtl,
                Size = 1
            });
            return set;
        }
        catch (Exception ex)
        {
            // Fail CLOSED to an empty set: everyone drops to their own subtree rather than the whole
            // org. Deliberately NOT a 503 like ManagerDirectoryService — this table lives in the same
            // Origination DB as the usage data itself, so if it is unreachable the dashboard's own
            // queries have already failed and surfaced the outage. Degrading quietly here just avoids
            // turning a data outage into an access-control surprise.
            _cache.Set(FailureCacheKey, true, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = FailureTtl,
                Size = 1
            });
            _logger.LogError(ex,
                "Could not read dbo.UsageDashboardViewAllUsers — failing closed, every caller is scoped to their own subtree.");
            return None;
        }
    }
}
