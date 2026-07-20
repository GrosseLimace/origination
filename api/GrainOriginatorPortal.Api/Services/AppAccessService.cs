using Microsoft.Extensions.Caching.Memory;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class AppAccessService : IAppAccessService
{
    private const string CacheKey = "app-access:members";
    private const int DefaultCacheMinutes = 30;
    // Failures cached briefly: long enough that a blocked Graph doesn't get hit on every poll/page
    // load, short enough that an IT grant takes effect within minutes.
    private static readonly TimeSpan FailureCacheTtl = TimeSpan.FromMinutes(5);
    // Hard cap on a cold-cache fetch. With egress blocked, each HTTP attempt runs to its 10s
    // timeout (x retries) — without this, the first dashboard hit of the day would hang ~30s.
    private static readonly TimeSpan FetchTimeout = TimeSpan.FromSeconds(8);

    private readonly IGraphDirectoryClient _graph;
    private readonly IConfiguration _config;
    private readonly IMemoryCache _cache;
    private readonly ILogger<AppAccessService> _logger;
    private readonly SemaphoreSlim _refreshLock = new(1, 1);

    public AppAccessService(
        IGraphDirectoryClient graph,
        IConfiguration config,
        IMemoryCache cache,
        ILogger<AppAccessService> logger)
    {
        _graph = graph;
        _config = config;
        _cache = cache;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<AppAccessSet> GetAccessSetAsync(CancellationToken cancellationToken)
    {
        if (_cache.TryGetValue(CacheKey, out AppAccessSet? cached) && cached is not null)
            return cached;

        await _refreshLock.WaitAsync(cancellationToken);
        try
        {
            // Double-check: another request may have refreshed while we waited.
            if (_cache.TryGetValue(CacheKey, out cached) && cached is not null)
                return cached;

            var set = await FetchAsync(cancellationToken);
            var cacheMinutes = _config.GetValue<int?>("AppAccess:CacheMinutes") ?? DefaultCacheMinutes;
            _cache.Set(CacheKey, set, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = set.Available ? TimeSpan.FromMinutes(cacheMinutes) : FailureCacheTtl,
                Size = 1 // IMemoryCache has a SizeLimit — entries must declare a size
            });
            return set;
        }
        finally
        {
            _refreshLock.Release();
        }
    }

    private async Task<AppAccessSet> FetchAsync(CancellationToken cancellationToken)
    {
        var groupName = _config.GetValue<string>("AppAccess:GroupName")?.Trim();
        if (string.IsNullOrEmpty(groupName))
        {
            _logger.LogWarning("App-access filter inactive: AppAccess:GroupName is not configured for this environment");
            return AppAccessSet.Unavailable;
        }

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(FetchTimeout);

            var group = await _graph.FindGroupByNameAsync(groupName, timeout.Token);
            if (!group.Ok)
                return LogUnavailable("group resolve", group.Status.ToString(), group.Detail);

            var members = await _graph.GetGroupTransitiveUserMembersAsync(group.Value!.Id, timeout.Token);
            if (!members.Ok)
                return LogUnavailable("member read", members.Status.ToString(), members.Detail);

            var shortNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var displayNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var user in members.Value!)
            {
                // Disabled accounts can't sign in — they don't count as "has access".
                if (string.IsNullOrEmpty(user.UserPrincipalName) || user.AccountEnabled == false)
                    continue;
                var shortName = user.UserPrincipalName.Split('@')[0];
                shortNames.Add(shortName);
                displayNames[shortName] = user.DisplayName ?? shortName;
            }

            _logger.LogInformation("App-access set refreshed: {MemberCount} enabled members", shortNames.Count);
            return new AppAccessSet { Available = true, ShortNames = shortNames, DisplayNames = displayNames };
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // Our own FetchTimeout fired (a blocked-egress attempt outliving the timebox).
            return LogUnavailable("fetch", "Timeout", $"exceeded the {FetchTimeout.TotalSeconds:F0}s fetch timebox");
        }
    }

    private AppAccessSet LogUnavailable(string step, string outcome, string? detail)
    {
        _logger.LogWarning(
            "App-access set unavailable at {Step} [{ErrorCode}] [{ErrorCategory}]: {Outcome} — {Detail}. " +
            "Consumers fall open to unfiltered entitlements behavior.",
            step, "INFRASTRUCTURE_GRAPH_UNAVAILABLE", "Infrastructure", outcome, detail);
        return AppAccessSet.Unavailable;
    }
}
