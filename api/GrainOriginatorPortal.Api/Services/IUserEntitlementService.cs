namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Resolves and caches the authenticated user's trade unit entitlements for the current request.
/// Used to enforce server-side authorization that users can only access data for their entitled trade units.
/// </summary>
public interface IUserEntitlementService
{
    /// <summary>
    /// Returns the set of trade unit codes the current user is entitled to access.
    /// Results are cached for the lifetime of the request (scoped service).
    /// </summary>
    Task<IReadOnlySet<string>> GetAllowedTradeUnitCodesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// True if the Entitlements DB was reachable on the last call to GetAllowedTradeUnitCodesAsync.
    /// False means the DB was unavailable and the returned set is empty by default — filters
    /// should skip enforcement rather than blocking all access.
    /// </summary>
    bool EntitlementsAvailable { get; }

    /// <summary>
    /// Validates that all provided trade unit codes are in the user's entitled set.
    /// Throws <see cref="Exceptions.ForbiddenException"/> if any are not allowed.
    /// </summary>
    Task ValidateTradeUnitsOrThrowAsync(IEnumerable<string> tradeUnitCodes, CancellationToken cancellationToken = default);

    /// <summary>
    /// Validates that the current user has access to the specified customer by checking
    /// the customer's trade unit(s) against the user's entitlements.
    /// Throws <see cref="Exceptions.ForbiddenException"/> if access is denied.
    ///
    /// ⚠️ INTENTIONALLY UNUSED on request paths — per-producer read authorization is accepted risk
    /// AR-02 (SECURITY-REVIEWS/ACCEPTED-RISKS.md). See the implementation for why, and what would
    /// break if it were enabled. Triage scan hits on the customer-scoped reads against AR-02.
    /// </summary>
    Task ValidateCustomerAccessAsync(long customerId, CancellationToken cancellationToken = default);
}
