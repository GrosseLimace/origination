using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Scoped service that lazily loads the authenticated user's trade unit entitlements
/// from the TradeUnitPreferences DB and caches them for the request lifetime.
/// Fail-closed: if entitlements cannot be loaded AND no recent value is cached, access is denied
/// (not silently allowed). On a transient TradeUnitPreferences DB outage the last-known-good entitlements
/// (cross-request <see cref="IMemoryCache"/>, short TTL) are served so reads stay correctly filtered
/// rather than falling open to all trade units; only a cold outage with no cache fails closed.
/// </summary>
public class UserEntitlementService : IUserEntitlementService
{
    /// <summary>How long a successfully-loaded entitlement set is retained as last-known-good for
    /// fallback during an TradeUnitPreferences DB outage. Kept short so revocations still take effect quickly
    /// once the DB recovers (the cache is a failure fallback, never the primary path).</summary>
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(10);

    private readonly IEntitlementsRepository _entitlements;
    private readonly IRequestContextService _requestContext;
    private readonly IMemoryCache _cache;
    private readonly ILogger<UserEntitlementService> _logger;

    private HashSet<string>? _cachedEntitlements;
    public bool EntitlementsAvailable { get; private set; } = true;

    public UserEntitlementService(
        IEntitlementsRepository entitlements,
        IRequestContextService requestContext,
        IMemoryCache cache,
        ILogger<UserEntitlementService> logger)
    {
        _entitlements = entitlements;
        _requestContext = requestContext;
        _cache = cache;
        _logger = logger;
    }

    private static string CacheKey(string userId) => $"entitlements:{userId}";

    public async Task<IReadOnlySet<string>> GetAllowedTradeUnitCodesAsync(CancellationToken cancellationToken = default)
    {
        if (_cachedEntitlements is not null)
            return _cachedEntitlements;

        var userId = _requestContext.GetCurrentUserShortName();
        if (string.IsNullOrWhiteSpace(userId))
            throw new ForbiddenException("Unable to determine user identity from token.");

        var cacheKey = CacheKey(userId);

        List<string> tradeUnitCodes;
        try
        {
            tradeUnitCodes = await _entitlements.GetTradeUnitCodesForUserAsync(userId, cancellationToken);
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            // Transient TradeUnitPreferences DB outage. Serve last-known-good entitlements if we have a
            // recent successful fetch cached — keeps reads correctly filtered instead of falling
            // open to all trade units. Only fail closed (empty set) when there is no cache.
            if (_cache.TryGetValue(cacheKey, out HashSet<string>? cached) && cached is not null)
            {
                _logger.LogWarning(ex,
                    "TradeUnitPreferences DB unavailable for user {UserId} — serving {Count} last-known-good cached entitlements. [{ErrorCode}]",
                    userId, cached.Count, "ENTITLEMENTS_DB_UNAVAILABLE_CACHED");
                _cachedEntitlements = cached;
                return _cachedEntitlements;
            }

            _logger.LogError(ex,
                "TradeUnitPreferences DB unavailable for user {UserId} and no cached entitlements — failing closed. [{ErrorCode}]",
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

    public async Task ValidateTradeUnitsOrThrowAsync(IEnumerable<string> tradeUnitCodes, CancellationToken cancellationToken = default)
    {
        var allowed = await GetAllowedTradeUnitCodesAsync(cancellationToken);
        var requested = tradeUnitCodes.Where(c => !string.IsNullOrWhiteSpace(c)).ToList();

        if (requested.Count == 0)
            return;

        var denied = requested.Where(c => !allowed.Contains(c)).ToList();
        if (denied.Count > 0)
        {
            var userId = _requestContext.GetCurrentUserShortName();
            _logger.LogWarning(
                "Trade unit access denied for user {UserId}. Requested: [{Requested}], Denied: [{Denied}]",
                userId, string.Join(", ", requested), string.Join(", ", denied));

            throw new ForbiddenException(
                $"Access denied: you are not authorized for trade unit(s) {string.Join(", ", denied)}.");
        }
    }

    /// <summary>
    /// Object-level authorization for a single customer: throws <see cref="ForbiddenException"/>
    /// unless the caller is entitled to at least one trade unit the customer belongs to.
    ///
    /// ⚠️ DELIBERATELY NOT CALLED ON ANY REQUEST PATH. This is not an oversight or dead code left
    /// behind — per-producer read authorization is an ACCEPTED RISK, recorded as AR-02 in
    /// SECURITY-REVIEWS/ACCEPTED-RISKS.md (re-reviewed and re-accepted 2026-08-10). Trade units are
    /// a UX default, not an access boundary: originators must be able to pull up any producer.
    ///
    /// Security scans repeatedly flag the customer-scoped reads (CustomersController GetById /
    /// GetBySourceId / GetLinkedTo / GetTradeUnits, NotesController GetByCustomer) as CWE-639 and
    /// suggest calling this method. Triage those hits against AR-02 rather than wiring this up — doing
    /// so would break three shipped or in-flight behaviours:
    ///   • cross-trade-unit coverage (a rep covering for someone else's producers),
    ///   • linked producers, whose links deliberately span trade units (GetLinkedTo),
    ///   • the incoming-call popup, which resolves an arbitrary caller to a producer page.
    /// It also fails CLOSED when a customer has no trade-unit mapping (see below), so enabling it
    /// would deny access to producers that haven't been synced yet.
    ///
    /// Kept — with tests — so the control is ready if that product decision is ever reversed. If you
    /// do wire it up, update AR-02 in the same change.
    /// </summary>
    public async Task ValidateCustomerAccessAsync(long customerId, CancellationToken cancellationToken = default)
    {
        // Look up customer's trade unit(s) from the live ODS view
        var customerTradeUnits = await _entitlements.GetCustomerTradeUnitCodesAsync(customerId, cancellationToken);

        if (customerTradeUnits.Count == 0)
        {
            // Deny by default: a customer with no trade-unit mapping cannot be authorized against the
            // caller's entitlements, so allowing access here would be a fail-open bypass (CWE-285) for
            // any not-yet-synced/unmapped customer. Fail closed instead.
            var requester = _requestContext.GetCurrentUserShortName();
            _logger.LogWarning(
                "Customer access denied for user {UserId}. Customer {CustomerId} has no trade unit mapping. [{ErrorCode}]",
                requester, customerId, "CUSTOMER_NO_TRADE_UNIT_MAPPING");
            throw new ForbiddenException($"Access denied: you are not authorized to access customer {customerId}.");
        }

        var allowed = await GetAllowedTradeUnitCodesAsync(cancellationToken);
        var hasAccess = customerTradeUnits.Any(tu => allowed.Contains(tu));

        if (!hasAccess)
        {
            var userId = _requestContext.GetCurrentUserShortName();
            _logger.LogWarning(
                "Customer access denied for user {UserId}. Customer {CustomerId} belongs to trade units [{CustomerTUs}]",
                userId, customerId, string.Join(", ", customerTradeUnits));

            throw new ForbiddenException(
                $"Access denied: you are not authorized to access customer {customerId}.");
        }
    }
}
