using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Api.Modules.Producers.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Interfaces;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Api.Modules.Producers.Mappings;
using GrainOriginatorPortal.Api.Modules.Customers.Services;

namespace GrainOriginatorPortal.Api.Modules.Producers.Services;

/// <inheritdoc />
public class DpContractService : IDpContractService
{
    private readonly IDpContractRepository _repository;
    private readonly ICustomerLookup _customers;
    private readonly IUserEntitlementService _entitlementService;

    public DpContractService(
        IDpContractRepository repository,
        ICustomerLookup customers,
        IUserEntitlementService entitlementService)
    {
        _repository = repository;
        _customers = customers;
        _entitlementService = entitlementService;
    }

    /// <inheritdoc />
    public async Task<List<DpContractResponse>> GetAllAsync(IEnumerable<string>? tradeUnits, CancellationToken cancellationToken)
    {
        var contracts = await _repository.GetAsync(tradeUnits, cancellationToken);

        // Entitlement scoping: narrow to producers in the caller's allowed trade units.
        var allowed = await _entitlementService.GetAllowedTradeUnitCodesAsync(cancellationToken);
        // Fail closed: if entitlements are unavailable and uncached, refuse rather than returning
        // data we can't authorize (CWE-285). Mirrors EnforceTradeUnitAccessAttribute.
        if (!_entitlementService.EntitlementsAvailable)
            throw new GrainOriginatorPortal.Api.Exceptions.InfrastructureException(
                "Authorization data is temporarily unavailable. Please retry shortly.",
                "ENTITLEMENTS_DB_UNAVAILABLE", StatusCodes.Status503ServiceUnavailable);
        var allowedCustomerIds = await _customers.GetActiveCustomerIdsInTradeUnitsAsync(allowed, cancellationToken);
        contracts = contracts.Where(d => allowedCustomerIds.Contains(d.CustomerId)).ToList();

        return contracts.Select(d => d.ToResponse()).ToList();
    }

    /// <inheritdoc />
    public async Task<List<DpContractResponse>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken)
    {
        var contracts = await _repository.GetByCustomerAsync(customerId, cancellationToken);
        return contracts.Select(d => d.ToResponse()).ToList();
    }
}
