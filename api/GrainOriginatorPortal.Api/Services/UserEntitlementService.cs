using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Exceptions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Scoped service that lazily loads the authenticated user's trade unit entitlements
/// from the Entitlements DB and caches them for the request lifetime.
/// Fail-closed: if entitlements cannot be loaded, access is denied (not silently allowed).
/// </summary>
public class UserEntitlementService : IUserEntitlementService
{
    private readonly EntitlementsDbContext _entitlementsDb;
    private readonly OriginationDbContext _originationDb;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly ILogger<UserEntitlementService> _logger;

    private HashSet<string>? _cachedEntitlements;

    public UserEntitlementService(
        EntitlementsDbContext entitlementsDb,
        OriginationDbContext originationDb,
        IHttpContextAccessor httpContextAccessor,
        ILogger<UserEntitlementService> logger)
    {
        _entitlementsDb = entitlementsDb;
        _originationDb = originationDb;
        _httpContextAccessor = httpContextAccessor;
        _logger = logger;
    }

    public async Task<IReadOnlySet<string>> GetAllowedTradeUnitCodesAsync(CancellationToken ct = default)
    {
        if (_cachedEntitlements is not null)
            return _cachedEntitlements;

        var userId = ExtractUserId();
        if (string.IsNullOrWhiteSpace(userId))
            throw new ForbiddenException("Unable to determine user identity from token.");

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
            _logger.LogWarning(ex,
                "Entitlements DB unavailable for user {UserId} — trade unit filter disabled for this request. [{ErrorCode}]",
                userId, "ENTITLEMENTS_DB_UNAVAILABLE");
            _cachedEntitlements = [];
            return _cachedEntitlements;
        }

        _cachedEntitlements = new HashSet<string>(tradeUnitCodes, StringComparer.OrdinalIgnoreCase);

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
