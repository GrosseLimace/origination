using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Delayed-pricing (DP) contract reads, with entitlement-based trade-unit scoping on the list.</summary>
public interface IDpContractService
{
    /// <summary>All DP positions the caller is entitled to see, optionally narrowed to the given trade units.</summary>
    Task<List<DpContractResponse>> GetAllAsync(IEnumerable<string>? tradeUnits, CancellationToken cancellationToken);

    /// <summary>DP positions for a single producer.</summary>
    Task<List<DpContractResponse>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);
}
