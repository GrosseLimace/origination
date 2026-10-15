using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class ManagerDirectoryService : IManagerDirectoryService
{
    private const string CacheKey = "usage-dash:manager-directory";
    private const string FailureCacheKey = "usage-dash:manager-directory:failed";

    /// <summary>The org hierarchy changes rarely and the read is a trivial ~1,150-row scan, so a
    /// short success TTL costs nothing and makes reorgs visible within minutes.</summary>
    private static readonly TimeSpan SuccessTtl = TimeSpan.FromMinutes(15);

    /// <summary>A recent failure short-circuits further reads so one dashboard page load
    /// (~8 endpoints) hitting a down DB produces one connection timeout, not eight.</summary>
    private static readonly TimeSpan FailureTtl = TimeSpan.FromSeconds(60);

    private readonly IUsageRepository _repo;
    private readonly IMemoryCache _cache;
    private readonly ILogger<ManagerDirectoryService> _logger;

    public ManagerDirectoryService(IUsageRepository repo, IMemoryCache cache, ILogger<ManagerDirectoryService> logger)
    {
        _repo = repo;
        _cache = cache;
        _logger = logger;
    }

    public async Task<List<UsageManagerDto>> GetManagersAsync(CancellationToken cancellationToken)
    {
        var rows = await GetRowsAsync(cancellationToken);

        // "Manager" = anyone who appears as someone's ManagerUserId. The view only resolves a
        // manager when the parent row is active, so this projection is guaranteed active — unlike
        // the IsManager flag, which still carries a few deactivated accounts.
        return rows
            .Where(r => !string.IsNullOrEmpty(r.ManagerUserId))
            .GroupBy(r => r.ManagerUserId!, StringComparer.OrdinalIgnoreCase)
            .Select(g =>
            {
                var hier = g.Select(r => r.ManagerHierId).FirstOrDefault(h => !string.IsNullOrEmpty(h));
                var childPrefix = hier + ".";
                return new UsageManagerDto
                {
                    UserId = g.Key,
                    DisplayName = g.Select(r => r.ManagerDisplayName).FirstOrDefault(n => !string.IsNullOrEmpty(n)) ?? g.Key,
                    DirectReports = g.Count(),
                    TotalReports = hier is null
                        ? g.Count()
                        : rows.Count(r => r.HierId is not null && r.HierId.StartsWith(childPrefix, StringComparison.Ordinal))
                };
            })
            .OrderBy(m => m.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<HashSet<string>?> GetSubtreeUserIdsAsync(string managerId, CancellationToken cancellationToken)
    {
        var rows = await GetRowsAsync(cancellationToken);

        // The manager's own HierID is any report row's ManagerHierID (resolved only for active
        // managers, so an unknown or deactivated id falls out here as null).
        var anchor = rows
            .Where(r => r.ManagerUserId is not null
                && string.Equals(r.ManagerUserId, managerId, StringComparison.OrdinalIgnoreCase))
            .Select(r => r.ManagerHierId)
            .FirstOrDefault(h => !string.IsNullOrEmpty(h));
        if (anchor is null) return null;

        // Seed with the manager: their own row (HierID == anchor) never matches the child prefix.
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { managerId };

        // The trailing dot keeps materialized-path prefixes honest: "01.1" must not match "01.11.x".
        var childPrefix = anchor + ".";
        foreach (var r in rows)
        {
            if (r.HierId is not null && r.HierId.StartsWith(childPrefix, StringComparison.Ordinal))
                set.Add(r.UserId);
            else if (r.ManagerUserId is not null
                && string.Equals(r.ManagerUserId, managerId, StringComparison.OrdinalIgnoreCase))
                set.Add(r.UserId); // direct report with a null/odd HierID still counts
        }
        return set;
    }

    private async Task<List<UserManagerRow>> GetRowsAsync(CancellationToken cancellationToken)
    {
        if (_cache.TryGetValue(CacheKey, out List<UserManagerRow>? rows) && rows is not null)
            return rows;
        if (_cache.TryGetValue(FailureCacheKey, out bool _))
            throw Unavailable(null);

        try
        {
            rows = await _repo.GetUserManagerLookupAsync(cancellationToken);
            // The shared IMemoryCache is registered with a SizeLimit, so every entry declares a size.
            _cache.Set(CacheKey, rows, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = SuccessTtl,
                Size = 1
            });
            return rows;
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _cache.Set(FailureCacheKey, true, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = FailureTtl,
                Size = 1
            });
            _logger.LogError(ex,
                "TradeUnitPreferences DB unavailable for manager lookup — failing closed (503). [{ErrorCode}]",
                "ENTITLEMENTS_DB_UNAVAILABLE");
            throw Unavailable(ex);
        }
    }

    private static InfrastructureException Unavailable(Exception? inner)
    {
        const string message = "The manager directory is temporarily unavailable. Please retry shortly.";
        const string code = "ENTITLEMENTS_DB_UNAVAILABLE";
        return inner is null
            ? new InfrastructureException(message, code)
            : new InfrastructureException(message, code, inner);
    }
}
