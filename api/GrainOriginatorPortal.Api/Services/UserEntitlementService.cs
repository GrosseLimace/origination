using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Data.SqlClient;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Scoped service that lazily loads the authenticated user's trade unit entitlements
/// from the Entitlements DB and caches them for the request lifetime.
/// Fail-closed: if entitlements cannot be loaded, access is denied (not silently allowed).
/// </summary>
public class UserEntitlementService : IUserEntitlementService
{
    private readonly IEntitlementsRepository _entitlements;
    private readonly IRequestContextService _requestContext;
    private readonly ILogger<UserEntitlementService> _logger;

    private HashSet<string>? _cachedEntitlements;
    public bool EntitlementsAvailable { get; private set; } = true;

    public UserEntitlementService(
        IEntitlementsRepository entitlements,
        IRequestContextService requestContext,
        ILogger<UserEntitlementService> logger)
    {
        _entitlements = entitlements;
        _requestContext = requestContext;
        _logger = logger;
    }

    public async Task<IReadOnlySet<string>> GetAllowedTradeUnitCodesAsync(CancellationToken cancellationToken = default)
    {
        if (_cachedEntitlements is not null)
            return _cachedEntitlements;

        var userId = _requestContext.GetCurrentUserShortName();
        if (string.IsNullOrWhiteSpace(userId))
            throw new ForbiddenException("Unable to determine user identity from token.");

        List<string> tradeUnitCodes;
        try
        {
            tradeUnitCodes = await _entitlements.GetTradeUnitCodesForUserAsync(userId, cancellationToken);
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex,
                "Entitlements DB unavailable for user {UserId} — trade unit filter disabled for this request. [{ErrorCode}]",
                userId, "ENTITLEMENTS_DB_UNAVAILABLE");
            EntitlementsAvailable = false;
            _cachedEntitlements = [];
            return _cachedEntitlements;
        }

        _cachedEntitlements = new HashSet<string>(tradeUnitCodes, StringComparer.OrdinalIgnoreCase);

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

    public async Task ValidateCustomerAccessAsync(long customerId, CancellationToken cancellationToken = default)
    {
        // Look up customer's trade unit(s) from the live ODS view
        var customerTradeUnits = await _entitlements.GetCustomerTradeUnitCodesAsync(customerId, cancellationToken);

        if (customerTradeUnits.Count == 0)
        {
            // Customer not found in ODS — allow access (may be a new customer not yet synced)
            _logger.LogInformation(
                "Customer {CustomerId} has no trade unit mapping in ODS — allowing access",
                customerId);
            return;
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
