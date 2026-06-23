using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class FarmService : IFarmService
{
    private readonly IFarmRepository _repository;

    public FarmService(IFarmRepository repository)
    {
        _repository = repository;
    }

    /// <inheritdoc />
    public async Task<List<FarmResponse>> GetAllAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
    {
        var farms = await _repository.GetAsync(tradeUnits, cancellationToken);
        return farms.Select(f => f.ToResponse()).ToList();
    }

    /// <inheritdoc />
    public async Task<FarmResponse?> GetByIdAsync(string id, CancellationToken cancellationToken)
    {
        var farm = await _repository.GetByIdAsync(id, cancellationToken);
        return farm?.ToResponse();
    }

    /// <inheritdoc />
    public async Task<List<FarmResponse>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken)
    {
        var farms = await _repository.GetByCustomerAsync(customerId, cancellationToken);
        return farms.Select(f => f.ToResponse()).ToList();
    }

    /// <inheritdoc />
    public Task<string> CreateAsync(string name, string location, int acres, CancellationToken cancellationToken) =>
        _repository.CreateAsync(name, location, acres, cancellationToken);
}
