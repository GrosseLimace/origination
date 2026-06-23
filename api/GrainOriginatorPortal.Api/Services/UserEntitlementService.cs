using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Exceptions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Scoped service that lazily loads the authenticated user's trade unit entitlements
/// from the Entitlements DB and caches them for the request lifetime.
/// Fail-closed: if entitlements cannot be loaded AND no recent value is cached, access is denied
/// (not silently allowed). On a transient Entitlements DB outage the last-known-good entitlements
/// (cross-request <see cref="IMemoryCache"/>, short TTL) are served so reads stay correctly filtered
/// rather than falling open to all trade units; only a cold outage with no cache fails closed.
/// </summary>
public class UserEntitlementService : IUserEntitlementService
{
    /// <summary>How long a successfully-loaded entitlement set is retained as last-known-good for
    /// fallback during an Entitlements DB outage. Kept short so revocations still take effect quickly
    /// once the DB recovers (the cache is a failure fallback, never the primary path).</summary>
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(10);

    private readonly EntitlementsDbContext _entitlementsDb;
    private readonly OriginationDbContext _originationDb;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly IMemoryCache _cache;
    private readonly ILogger<UserEntitlementService> _logger;

    private HashSet<string>? _cachedEntitlements;
    public bool EntitlementsAvailable { get; private set; } = true;

    public UserEntitlementService(
        EntitlementsDbContext entitlementsDb,
        OriginationDbContext originationDb,
        IHttpContextAccessor httpContextAccessor,
        IMemoryCache cache,
        ILogger<UserEntitlementService> logger)
    {
        _entitlementsDb = entitlementsDb;
        _originationDb = originationDb;
        _httpContextAccessor = httpContextAccessor;
        _cache = cache;
        _logger = logger;
    }

    private static string CacheKey(string userId) => $"entitlements:{userId}";

    public async Task<IReadOnlySet<string>> GetAllowedTradeUnitCodesAsync(CancellationToken ct = default)
    {
        if (_cachedEntitlements is not null)
            return _cachedEntitlements;

        var userId = ExtractUserId();
        if (string.IsNullOrWhiteSpace(userId))
            throw new ForbiddenException("Unable to determine user identity from token.");

        var cacheKey = CacheKey(userId);

        List<string> tradeUnitCodes;
        try
        {
            tradeUnitCodes = await _entitlementsDb.UserTradeUnitAccess
                .Where(u => u.UserId == userId)
                .Select(u => u.TradeUnitCode)
                .Distinct()
                .ToListAsync(ct);
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            // Transient Entitlements DB outage. Serve last-known-good entitlements if we have a
            // recent successful fetch cached — keeps reads correctly filtered instead of falling
            // open to all trade units. Only fail closed (empty set) when there is no cache.
            if (_cache.TryGetValue(cacheKey, out HashSet<string>? cached) && cached is not null)
            {
                _logger.LogWarning(ex,
                    "Entitlements DB unavailable for user {UserId} — serving {Count} last-known-good cached entitlements. [{ErrorCode}]",
                    userId, cached.Count, "ENTITLEMENTS_DB_UNAVAILABLE_CACHED");
                _cachedEntitlements = cached;
                return _cachedEntitlements;
            }

            _logger.LogError(ex,
                "Entitlements DB unavailable for user {UserId} and no cached entitlements — failing closed. [{ErrorCode}]",
                userId, "ENTITLEMENTS_DB_UNAVAILABLE");
            EntitlementsAvailable = false;
            _cachedEntitlements = [];
            return _cachedEntitlements;
        }

        _cachedEntitlements = new HashSet<string>(tradeUnitCodes, StringComparer.OrdinalIgnoreCase);

        // Refresh the cross-request last-known-good cache (Size required — IMemoryCache has a SizeLimit).
        _cache.Set(cacheKey, _cachedEntitlements, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = CacheTtl,
            Size = 1
        });

        _logger.LogInformation(
            "Loaded {Count} trade unit entitlements for user {UserId}",
            _cachedEntitlements.Count, userId);

        return _cachedEntitlements;
    }

    public async Task ValidateTradeUnitsOrThrowAsync(IEnumerable<string> tradeUnitCodes, CancellationToken ct = default)
    {
        var allowed = await GetAllowedTradeUnitCodesAsync(ct);
        var requested = tradeUnitCodes.Where(c => !string.IsNullOrWhiteSpace(c)).ToList();

        if (requested.Count == 0)
            return;

        var denied = requested.Where(c => !allowed.Contains(c)).ToList();
        if (denied.Count > 0)
        {
            var userId = ExtractUserId();
            _logger.LogWarning(
                "Trade unit access denied for user {UserId}. Requested: [{Requested}], Denied: [{Denied}]",
                userId, string.Join(", ", requested), string.Join(", ", denied));

            throw new ForbiddenException(
                $"Access denied: you are not authorized for trade unit(s) {string.Join(", ", denied)}.");
        }
    }

    public async Task ValidateCustomerAccessAsync(long customerId, CancellationToken ct = default)
    {
        // Look up customer's trade unit(s) from the live ODS view
        var customerTradeUnits = await _originationDb.CustomerTradeUnits
            .Where(c => c.CustomerId == customerId)
            .Select(c => c.TradeUnit)
            .Where(tu => tu != null)
            .Distinct()
            .ToListAsync(ct);

        if (customerTradeUnits.Count == 0)
        {
            // Customer not found in ODS — allow access (may be a new customer not yet synced)
            _logger.LogInformation(
                "Customer {CustomerId} has no trade unit mapping in ODS — allowing access",
                customerId);
            return;
        }

        var allowed = await GetAllowedTradeUnitCodesAsync(ct);
        var hasAccess = customerTradeUnits.Any(tu => allowed.Contains(tu!));

        if (!hasAccess)
        {
            var userId = ExtractUserId();
            _logger.LogWarning(
                "Customer access denied for user {UserId}. Customer {CustomerId} belongs to trade units [{CustomerTUs}]",
                userId, customerId, string.Join(", ", customerTradeUnits));

            throw new ForbiddenException(
                $"Access denied: you are not authorized to access customer {customerId}.");
        }
    }

    private string ExtractUserId()
    {
        var user = _httpContextAccessor.HttpContext?.User;
        if (user is null)
            return string.Empty;

        var upn = user.FindFirst("preferred_username")?.Value
            ?? user.FindFirst("upn")?.Value
            ?? user.FindFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn")?.Value
            ?? user.Identity?.Name
            ?? string.Empty;

        return upn.Contains('@') ? upn.Split('@')[0] : upn;
    }
}
