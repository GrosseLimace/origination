using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>Read-only access to the Entitlements DB's vw_UserTradeUnitPreference — the authoritative
/// user→trade-unit assignment catalog. Callers handle the "entitlements unavailable" fallback.</summary>
public interface IEntitlementsRepository
{
    /// <summary>Distinct trade-unit assignments for a single user (group name + code).</summary>
    Task<List<UserTradeUnitPreference>> GetByUserAsync(string userId, CancellationToken cancellationToken);

    /// <summary>All trade-unit assignments (the full catalog — code + description), used to build the TU picker.</summary>
    Task<List<UserTradeUnitPreference>> GetAllAsync(CancellationToken cancellationToken);

    /// <summary>Trade-unit assignment rows for every user belonging to any of the given trade-unit codes.
    /// Used to build the manager's team-member picker. Callers de-dupe by <c>UserId</c>.</summary>
    Task<List<UserTradeUnitPreference>> GetUsersByTradeUnitsAsync(IReadOnlyCollection<string> tradeUnitCodes, CancellationToken cancellationToken);

    /// <summary>Distinct trade-unit codes a user is entitled to (the allowed set for access checks).</summary>
    Task<List<string>> GetTradeUnitCodesForUserAsync(string userId, CancellationToken cancellationToken);

    /// <summary>Distinct trade-unit codes a customer belongs to, from the ODS vw_CustomerTradeUnits
    /// view — used to validate per-customer access against a user's entitlements.</summary>
    Task<List<string>> GetCustomerTradeUnitCodesAsync(long customerId, CancellationToken cancellationToken);
}
