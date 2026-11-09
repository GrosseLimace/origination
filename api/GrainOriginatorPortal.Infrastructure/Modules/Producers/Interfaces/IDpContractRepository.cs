using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Interfaces;

/// <summary>Read access to delayed-pricing (DP) contract positions from the ODS.</summary>
public interface IDpContractRepository
{
    /// <summary>DP positions for the producers in the given trade units (cross-TU per producer), or all when none given.</summary>
    Task<List<DpContract>> GetAsync(IEnumerable<string>? tradeUnits, CancellationToken cancellationToken);

    /// <summary>DP positions for a single producer (resolved to its ScoularId).</summary>
    Task<List<DpContract>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);
}
