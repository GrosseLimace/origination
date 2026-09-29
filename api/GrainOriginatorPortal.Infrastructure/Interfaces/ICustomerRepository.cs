using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Read/write access to producers (dbo.Customer) and their trade-unit memberships
/// (dbo.CustomerTradeUnit), plus the ODS onboarding-search fallback (base.vw_CurrentCustomers)
/// and eSign enrichment. Reads return the happy-path result (callers own SqlException → empty-list
/// fallbacks and trace-id error logging); the trade-unit writes coordinate with the nightly
/// CustomerSync via the IsManual / UserDeactivated flags.
/// </summary>
public interface ICustomerRepository
{
    Task<List<Customer>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken);
    Task<List<Customer>> SearchAsync(string searchTerm, List<string>? tradeUnits, CancellationToken cancellationToken);
    Task<List<Customer>> SearchOdsAsync(string searchTerm, CancellationToken cancellationToken);
    Task<Customer?> GetByIdAsync(long id, CancellationToken cancellationToken);
    Task<Customer?> GetByScoularIdAsync(string scoularId, CancellationToken cancellationToken);
    Task<List<Customer>> GetLinkedToAsync(string scoularId, CancellationToken cancellationToken);
    Task<AssignTradeUnitsResult> AssignTradeUnitsAsync(long customerId, List<string> tradeUnitCodes, string currentUser, CancellationToken cancellationToken);
    Task<List<CustomerTradeUnitMembership>> GetTradeUnitsAsync(long customerId, CancellationToken cancellationToken);
    /// <summary>The memberships alone, without the open-activity check (HasOpenActivity stays true).</summary>
    Task<List<CustomerTradeUnitMembership>> GetTradeUnitMembershipsAsync(long customerId, CancellationToken cancellationToken);
    Task<HashSet<string>> GetOpenActivityTradeUnitsAsync(string scoularId, CancellationToken cancellationToken);
    Task<DeactivateTradeUnitResult> DeactivateDormantTradeUnitAsync(long customerId, string tradeUnit, string currentUser, CancellationToken cancellationToken);

    /// <summary>Active customer IDs that belong to any of the given trade units — used by services
    /// to scope list results to the caller's entitled trade units.</summary>
    Task<HashSet<long>> GetActiveCustomerIdsInTradeUnitsAsync(IReadOnlyCollection<string> tradeUnits, CancellationToken cancellationToken);

    /// <summary>The customer's first active trade-unit code (or null), ordered by code so the
    /// result is deterministic for multi-TU producers. Used to stamp records when the caller
    /// did not choose a trade unit.</summary>
    Task<string?> GetFirstActiveTradeUnitAsync(long customerId, CancellationToken cancellationToken);

    /// <summary>All of the customer's active trade-unit codes from dbo.CustomerTradeUnit, ordered
    /// by code. Empty when the producer has no membership rows (contracts-only / not yet synced).</summary>
    Task<List<string>> GetActiveTradeUnitCodesAsync(long customerId, CancellationToken cancellationToken);

    /// <summary>All distinct active trade-unit codes from dbo.CustomerTradeUnit, ordered — the
    /// fallback TU catalog when the TradeUnitPreferences DB is unavailable.</summary>
    Task<List<string>> GetAllActiveTradeUnitCodesAsync(CancellationToken cancellationToken);
}
