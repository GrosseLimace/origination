using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Customer-storage grain reads, with entitlement-based trade-unit scoping on the list.</summary>
public interface IStoredGrainService
{
    /// <summary>Stored grain for the given trade units (or all), scoped to the caller's entitled
    /// trade units when entitlements are available.</summary>
    Task<List<StoredGrainResponse>> GetAllAsync(IEnumerable<string>? tradeUnits, CancellationToken cancellationToken);

    /// <summary>Stored grain for a single producer.</summary>
    Task<List<StoredGrainResponse>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);
}
