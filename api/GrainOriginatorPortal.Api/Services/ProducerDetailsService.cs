using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class ProducerDetailsService : IProducerDetailsService
{
    private readonly IProducerDetailsRepository _repository;
    private readonly ICustomerRepository _customerRepository;
    private readonly IUserEntitlementService _entitlementService;
    private readonly IDisplayNameLookupRepository _displayNameLookup;
    private readonly IRequestContextService _requestContext;
    private readonly ILogger<ProducerDetailsService> _logger;

    public ProducerDetailsService(
        IProducerDetailsRepository repository,
        ICustomerRepository customerRepository,
        IUserEntitlementService entitlementService,
        IDisplayNameLookupRepository displayNameLookup,
        IRequestContextService requestContext,
        ILogger<ProducerDetailsService> logger)
    {
        _repository = repository;
        _customerRepository = customerRepository;
        _entitlementService = entitlementService;
        _displayNameLookup = displayNameLookup;
        _requestContext = requestContext;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<List<ProducerDetailsResponse>> GetAllAsync(CancellationToken cancellationToken)
    {
        List<ProducerDetails> all;
        IReadOnlyDictionary<string, string> nameMap;
        try
        {
            all = await _repository.GetAllAsync(cancellationToken);
            nameMap = await _displayNameLookup.ResolveAsync(
                all.Select(p => p.CreatedBy).Concat(all.Select(p => p.ModifiedBy ?? string.Empty)),
                cancellationToken);
        }
        catch (Exception ex)
        {
            // ProducerDetails is an app table that should always exist; stay defensive (the prior
            // SqlDataService behavior) and degrade to an empty list rather than failing the page.
            _logger.LogWarning(ex, "ProducerDetails not accessible. Returning empty list.");
            return [];
        }

        // Entitlement scoping: narrow to producers in the caller's allowed trade units.
        var allowed = await _entitlementService.GetAllowedTradeUnitCodesAsync(cancellationToken);
        // Fail closed: if entitlements are unavailable and uncached, refuse rather than returning
        // data we can't authorize (CWE-285). Mirrors EnforceTradeUnitAccessAttribute.
        if (!_entitlementService.EntitlementsAvailable)
            throw new GrainOriginatorPortal.Api.Exceptions.InfrastructureException(
                "Authorization data is temporarily unavailable. Please retry shortly.",
                "ENTITLEMENTS_DB_UNAVAILABLE", StatusCodes.Status503ServiceUnavailable);
        var allowedCustomerIds = await _customerRepository.GetActiveCustomerIdsInTradeUnitsAsync(allowed, cancellationToken);
        all = all.Where(d => allowedCustomerIds.Contains(d.CustomerId)).ToList();

        return all.Select(p => p.ToResponse(nameMap)).ToList();
    }

    /// <inheritdoc />
    public async Task<ProducerDetailsResponse> GetByCustomerAsync(long customerId, CancellationToken cancellationToken)
    {
        var pd = await _repository.GetAsync(customerId, cancellationToken);
        if (pd is null)
            return new ProducerDetailsResponse { CustomerId = customerId };

        var nameMap = await _displayNameLookup.ResolveAsync(
            new[] { pd.CreatedBy, pd.ModifiedBy ?? string.Empty }, cancellationToken);
        return pd.ToResponse(nameMap);
    }

    /// <inheritdoc />
    public async Task<ProducerDetailsResponse> UpsertAsync(long customerId, string? scoularId, string customerName,
        decimal? totalAcres, decimal? binCapacity, string? primaryContact, string? commodities,
        string? linkedProducerIds, CancellationToken cancellationToken)
    {
        var saved = await _repository.UpsertAsync(customerId, scoularId, customerName, totalAcres, binCapacity,
            primaryContact, commodities, linkedProducerIds, _requestContext.GetCurrentUser(), cancellationToken);

        var nameMap = await _displayNameLookup.ResolveAsync(
            new[] { saved.CreatedBy, saved.ModifiedBy ?? string.Empty }, cancellationToken);
        return saved.ToResponse(nameMap);
    }

    /// <inheritdoc />
    public Task DeleteAsync(long customerId, CancellationToken cancellationToken) =>
        _repository.DeleteAsync(customerId, cancellationToken);
}
