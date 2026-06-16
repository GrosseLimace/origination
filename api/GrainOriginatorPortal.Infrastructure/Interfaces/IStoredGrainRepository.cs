using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>Read access to customer-storage (warehouse-receipt) grain from the ODS.</summary>
public interface IStoredGrainRepository
{
    /// <summary>Stored grain for the producers in the given trade units (cross-TU per producer), or all when none given.</summary>
    Task<List<StoredGrain>> GetAsync(IEnumerable<string>? tradeUnits, CancellationToken cancellationToken);

    /// <summary>Stored grain for a single producer (resolved to its ScoularId).</summary>
    Task<List<StoredGrain>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);
}
