using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

/// <summary>Stub implementation — no Farms table exists in the ODS yet.</summary>
public class FarmRepository : IFarmRepository
{
    private readonly ILogger<FarmRepository> _logger;

    public FarmRepository(ILogger<FarmRepository> logger)
    {
        _logger = logger;
    }

    public Task<List<Farm>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - returning empty list");
        return Task.FromResult(new List<Farm>());
    }

    public Task<List<Farm>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - returning empty list for customer {CustomerId}", customerId);
        return Task.FromResult(new List<Farm>());
    }

    public Task<Farm?> GetByIdAsync(string id, CancellationToken cancellationToken)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - returning null for farm {FarmId}", id);
        return Task.FromResult<Farm?>(null);
    }

    public Task<string> CreateAsync(string name, string location, int acres, CancellationToken cancellationToken)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - cannot create farm {FarmName}", name);
        throw new NotImplementedException("Farm creation is not supported - Farms table doesn't exist in ODS");
    }
}
