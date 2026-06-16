using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>Read-only access to the Entitlements DB's vw_UserTradeUnitAccess — the authoritative
/// user→trade-unit assignment catalog. Callers handle the "entitlements unavailable" fallback.</summary>
public interface IEntitlementsRepository
{
    /// <summary>Distinct trade-unit assignments for a single user (group name + code).</summary>
    Task<List<UserTradeUnitAccess>> GetByUserAsync(string userId, CancellationToken cancellationToken);

    /// <summary>All trade-unit assignments (the full catalog — code + description), used to build the TU picker.</summary>
    Task<List<UserTradeUnitAccess>> GetAllAsync(CancellationToken cancellationToken);
}
