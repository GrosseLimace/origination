using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

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
    Task UpdateAsync(long customerId, string location, string phone, string email, List<string> farmIds, List<string> linkedProducerIds, CancellationToken cancellationToken);
    Task<AssignTradeUnitsResult> AssignTradeUnitsAsync(long customerId, List<string> tradeUnitCodes, CancellationToken cancellationToken);
    Task<List<CustomerTradeUnitMembership>> GetTradeUnitsAsync(long customerId, CancellationToken cancellationToken);
    Task<HashSet<string>> GetOpenActivityTradeUnitsAsync(string scoularId, CancellationToken cancellationToken);
    Task<DeactivateTradeUnitResult> DeactivateDormantTradeUnitAsync(long customerId, string tradeUnit, CancellationToken cancellationToken);

    /// <summary>Active customer IDs that belong to any of the given trade units — used by services
    /// to scope list results to the caller's entitled trade units.</summary>
    Task<HashSet<long>> GetActiveCustomerIdsInTradeUnitsAsync(IReadOnlyCollection<string> tradeUnits, CancellationToken cancellationToken);

    /// <summary>The customer's first active trade-unit code (or null), used to stamp records
    /// authoritatively rather than trusting client-supplied trade units.</summary>
    Task<string?> GetFirstActiveTradeUnitAsync(long customerId, CancellationToken cancellationToken);
}
