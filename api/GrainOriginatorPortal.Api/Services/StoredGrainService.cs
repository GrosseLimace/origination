using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class StoredGrainService : IStoredGrainService
{
    private readonly IStoredGrainRepository _repository;
    private readonly ICustomerRepository _customerRepository;
    private readonly IUserEntitlementService _entitlementService;

    public StoredGrainService(
        IStoredGrainRepository repository,
        ICustomerRepository customerRepository,
        IUserEntitlementService entitlementService)
    {
        _repository = repository;
        _customerRepository = customerRepository;
        _entitlementService = entitlementService;
    }

    /// <inheritdoc />
    public async Task<List<StoredGrainResponse>> GetAllAsync(IEnumerable<string>? tradeUnits, CancellationToken cancellationToken)
    {
        var grain = await _repository.GetAsync(tradeUnits, cancellationToken);

        // Entitlement scoping: when the Entitlements DB is reachable, narrow to producers in the
        // caller's allowed trade units (a UX/visibility default — see the controller's prior logic,
        // now owned by the service so no DbContext leaks into the controller).
        if (_entitlementService.EntitlementsAvailable)
        {
            var allowed = await _entitlementService.GetAllowedTradeUnitCodesAsync(cancellationToken);
            var allowedCustomerIds = await _customerRepository.GetActiveCustomerIdsInTradeUnitsAsync(allowed, cancellationToken);
            grain = grain.Where(g => allowedCustomerIds.Contains(g.CustomerId)).ToList();
        }

        return grain.Select(g => g.ToResponse()).ToList();
    }

    /// <inheritdoc />
    public async Task<List<StoredGrainResponse>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken)
    {
        var grain = await _repository.GetByCustomerAsync(customerId, cancellationToken);
        return grain.Select(g => g.ToResponse()).ToList();
    }
}
