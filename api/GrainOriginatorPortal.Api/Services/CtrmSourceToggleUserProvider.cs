using GrainOriginatorPortal.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>The active rows of <c>dbo.CtrmSourceToggleUsers</c>: who may choose their own data source.</summary>
public interface ICtrmSourceToggleUserProvider
{
    /// <summary>UPNs of active testers, case-insensitive. Empty when the table cannot be read.</summary>
    Task<IReadOnlyCollection<string>> GetAsync(CancellationToken cancellationToken);
}

/// <summary>
/// Reads the tester table once a minute and hands every request the same set, like
/// <see cref="UsageDashboardViewAllProvider"/> does for the view-all list.
/// </summary>
/// <remarks>
/// <para>Cached because the middleware consults it on every authenticated request. Sixty seconds is the
/// most a newly added tester waits for their toggle to appear, and no restart is needed.</para>
///
/// <para>Fails CLOSED to an empty set: if the table cannot be read, nobody can choose and every request
/// takes the environment default, which is the behaviour the app had before the toggle existed. The
/// config list (<c>Ctrm:SourceToggleUsers</c>) is checked separately by the middleware, so a database
/// problem never locks out a tester named there.</para>
/// </remarks>
public sealed class CtrmSourceToggleUserProvider : ICtrmSourceToggleUserProvider
{
    private const string CacheKey = "ctrm:toggle-users";
    private const string FailureCacheKey = "ctrm:toggle-users:failed";
    private static readonly TimeSpan SuccessTtl = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan FailureTtl = TimeSpan.FromSeconds(30);
    private static readonly IReadOnlyCollection<string> None = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    private readonly ApplicationDbContext _db;
    private readonly IMemoryCache _cache;
    private readonly ILogger<CtrmSourceToggleUserProvider> _logger;

    public CtrmSourceToggleUserProvider(ApplicationDbContext db, IMemoryCache cache, ILogger<CtrmSourceToggleUserProvider> logger)
    {
        _db = db;
        _cache = cache;
        _logger = logger;
    }

    public async Task<IReadOnlyCollection<string>> GetAsync(CancellationToken cancellationToken)
    {
        if (_cache.TryGetValue(CacheKey, out IReadOnlyCollection<string>? cached) && cached is not null)
            return cached;
        if (_cache.TryGetValue(FailureCacheKey, out bool _))
            return None;

        try
        {
            var ids = await _db.CtrmSourceToggleUsers
                .AsNoTracking()
                .Where(u => u.IsActive)
                .Select(u => u.UserId)
                .ToListAsync(cancellationToken);

            IReadOnlyCollection<string> set = new HashSet<string>(
                ids.Select(id => id.Trim()).Where(id => id.Length > 0), StringComparer.OrdinalIgnoreCase);
            // The shared IMemoryCache has a SizeLimit, so every entry declares a size.
            _cache.Set(CacheKey, set, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = SuccessTtl, Size = 1 });
            return set;
        }
        catch (Exception ex)
        {
            _cache.Set(FailureCacheKey, true, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = FailureTtl, Size = 1 });
            _logger.LogError(ex, "Could not read dbo.CtrmSourceToggleUsers - failing closed, no table-listed tester can choose a data source until it is readable again.");
            return None;
        }
    }
}
