using GrainOriginatorPortal.Infrastructure.Modules.Customers.Entities;


namespace GrainOriginatorPortal.Infrastructure.Modules.Customers.Interfaces;

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
    /// <summary>The active customers among <paramref name="customerIds"/>, with e-sign, ACH and trade units filled in.</summary>
    Task<List<Customer>> GetActiveByIdsAsync(IReadOnlyCollection<long> customerIds, CancellationToken cancellationToken);
    /// <summary>The name and CTRM code of each of <paramref name="customerIds"/> that exists, active or not.</summary>
    Task<Dictionary<long, (string Name, string? ScoularId)>> GetNamesAsync(IReadOnlyCollection<long> customerIds, CancellationToken cancellationToken);
    Task<AssignTradeUnitsOutcome> AssignTradeUnitsAsync(long customerId, List<string> tradeUnitCodes, string? scoularId, string currentUser, CancellationToken cancellationToken);
    Task<List<CustomerTradeUnitMembership>> GetTradeUnitsAsync(long customerId, CancellationToken cancellationToken);
    /// <summary>The memberships alone, without the open-activity check (HasOpenActivity stays true).</summary>
    Task<List<CustomerTradeUnitMembership>> GetTradeUnitMembershipsAsync(long customerId, CancellationToken cancellationToken);
    Task<HashSet<string>> GetOpenActivityTradeUnitsAsync(string scoularId, CancellationToken cancellationToken);
    Task<DeactivateTradeUnitResult> DeactivateDormantTradeUnitAsync(long customerId, string tradeUnit, string currentUser, CancellationToken cancellationToken);

    /// <summary>Active customer IDs that belong to any of the given trade units — used by services
    /// to scope list results to the caller's entitled trade units.</summary>
    Task<HashSet<long>> GetActiveCustomerIdsInTradeUnitsAsync(IReadOnlyCollection<string> tradeUnits, CancellationToken cancellationToken);

    /// <summary>All of the customer's active trade-unit codes from dbo.CustomerTradeUnit, ordered
    /// by code. Empty when the producer has no membership rows (contracts-only / not yet synced).</summary>
    Task<List<string>> GetActiveTradeUnitCodesAsync(long customerId, CancellationToken cancellationToken);

}
