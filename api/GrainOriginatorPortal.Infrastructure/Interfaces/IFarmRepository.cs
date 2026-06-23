using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Farm data access. There is no Farms table in the ODS yet, so these are stubs (empty/null/throw)
/// — the contract exists so the real implementation has a home when the table lands.
/// </summary>
public interface IFarmRepository
{
    Task<List<Farm>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken);
    Task<List<Farm>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);
    Task<Farm?> GetByIdAsync(string id, CancellationToken cancellationToken);
    Task<string> CreateAsync(string name, string location, int acres, CancellationToken cancellationToken);
}
