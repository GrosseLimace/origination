using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class PlantingIntentionService : IPlantingIntentionService
{
    private readonly IPlantingIntentionRepository _repository;
    private readonly ICustomerRepository _customerRepository;
    private readonly IUserEntitlementService _entitlementService;
    private readonly IDisplayNameLookupRepository _displayNameLookup;
    private readonly IRequestContextService _requestContext;
    private readonly ILogger<PlantingIntentionService> _logger;

    public PlantingIntentionService(
        IPlantingIntentionRepository repository,
        ICustomerRepository customerRepository,
        IUserEntitlementService entitlementService,
        IDisplayNameLookupRepository displayNameLookup,
        IRequestContextService requestContext,
        ILogger<PlantingIntentionService> logger)
    {
        _repository = repository;
        _customerRepository = customerRepository;
        _entitlementService = entitlementService;
        _displayNameLookup = displayNameLookup;
        _requestContext = requestContext;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<List<PlantingIntentionResponse>> GetAllAsync(string? tradeUnits, int? plantingYear, CancellationToken cancellationToken)
    {
        var tuList = tradeUnits?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var intentions = await _repository.GetAsync(tuList, plantingYear, cancellationToken);

        var allowed = await _entitlementService.GetAllowedTradeUnitCodesAsync(cancellationToken);
        // Fail closed: if entitlements are unavailable and uncached, refuse rather than returning
        // data we can't authorize (CWE-285). Mirrors EnforceTradeUnitAccessAttribute.
        if (!_entitlementService.EntitlementsAvailable)
            throw new GrainOriginatorPortal.Api.Exceptions.InfrastructureException(
                "Authorization data is temporarily unavailable. Please retry shortly.",
                "ENTITLEMENTS_DB_UNAVAILABLE", StatusCodes.Status503ServiceUnavailable);
        intentions = intentions.Where(i => string.IsNullOrEmpty(i.TradeUnit) || allowed.Contains(i.TradeUnit)).ToList();

        return await MapWithNamesAsync(intentions, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<List<PlantingIntentionResponse>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken)
    {
        var intentions = await _repository.GetByCustomerAsync(customerId, cancellationToken);
        return await MapWithNamesAsync(intentions, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<PlantingIntentionResponse?> GetByIdAsync(int intentionId, CancellationToken cancellationToken)
    {
        var intention = await _repository.GetByIdAsync(intentionId, cancellationToken);
        if (intention is null) return null;
        var nameMap = await _displayNameLookup.ResolveAsync(
            new[] { intention.CreatedBy, intention.ModifiedBy ?? string.Empty }, cancellationToken);
        return intention.ToResponse(nameMap);
    }

    /// <inheritdoc />
    public async Task<PlantingIntentionResponse> CreateAsync(long customerId, string? customerName, string? customerCode,
        string? tradeUnit, string crop, string? category, string? type, string? description, int acres,
        int plantingYear, CancellationToken cancellationToken)
    {
        // Derive customer metadata from the authoritative dbo.Customer + dbo.CustomerTradeUnit rather
        // than trusting client-supplied values. This prevents callers from spoofing trade units or
        // customer identity to make records appear in unauthorized views. (Logic moved verbatim out
        // of PlantingIntentionsController.Create so the controller no longer touches a DbContext.)
        var customer = await _customerRepository.GetByIdAsync(customerId, cancellationToken);
        var customerTU = await _customerRepository.GetFirstActiveTradeUnitAsync(customerId, cancellationToken);

        var resolvedName = customer?.Name ?? customerName ?? string.Empty;
        var resolvedCode = customer?.ScoularId ?? customerCode ?? string.Empty;
        var resolvedTradeUnit = customerTU ?? tradeUnit;

        if (string.IsNullOrWhiteSpace(resolvedTradeUnit))
        {
            // Capture the actual cause of a "save fails the first time" report: records whether the
            // server-derived trade unit was missing and what (if anything) the client supplied.
            _logger.LogWarning(
                "Planting intention create rejected — no trade unit. CustomerId={CustomerId}, CustomerFound={CustomerFound}, ServerTradeUnitResolved={ServerTuResolved}, ClientTradeUnit={ClientTradeUnit}, Crop={Crop}",
                customerId, customer is not null, customerTU is not null, tradeUnit ?? "(none)", crop);
            throw new ValidationException("tradeUnit",
                "Trade unit could not be determined for this customer. Please select a trade unit and try again.");
        }

        PlantingIntention intention;
        try
        {
            intention = await _repository.AddAsync(customerId, resolvedName, resolvedCode, resolvedTradeUnit,
                crop, category, type, description, acres, plantingYear, _requestContext.GetCurrentUser(), cancellationToken);
        }
        catch (Exception ex)
        {
            // Capture transient/persistence failures (the other candidate behind the retry-succeeds
            // symptom) with full context, then rethrow so the API still surfaces the error.
            _logger.LogError(ex,
                "Planting intention persistence failed. CustomerId={CustomerId}, TradeUnit={TradeUnit}, Crop={Crop}, PlantingYear={PlantingYear}",
                customerId, resolvedTradeUnit, crop, plantingYear);
            throw;
        }

        var nameMap = await _displayNameLookup.ResolveAsync(new[] { intention.CreatedBy }, cancellationToken);
        return intention.ToResponse(nameMap);
    }

    /// <inheritdoc />
    public async Task<PlantingIntentionResponse?> UpdateAsync(int intentionId, string crop, string? category, string? type,
        string? description, int acres, int plantingYear, CancellationToken cancellationToken)
    {
        var intention = await _repository.UpdateAsync(intentionId, crop, category, type, description, acres,
            plantingYear, _requestContext.GetCurrentUser(), cancellationToken);
        if (intention is null) return null;

        var nameMap = await _displayNameLookup.ResolveAsync(
            new[] { intention.CreatedBy, intention.ModifiedBy ?? string.Empty }, cancellationToken);
        return intention.ToResponse(nameMap);
    }

    /// <inheritdoc />
    public Task DeleteAsync(int intentionId, CancellationToken cancellationToken) =>
        _repository.DeleteAsync(intentionId, cancellationToken);

    private async Task<List<PlantingIntentionResponse>> MapWithNamesAsync(List<PlantingIntention> intentions, CancellationToken cancellationToken)
    {
        var nameMap = await _displayNameLookup.ResolveAsync(
            intentions.Select(i => i.CreatedBy).Concat(intentions.Select(i => i.ModifiedBy ?? string.Empty)),
            cancellationToken);
        return intentions.Select(i => i.ToResponse(nameMap)).ToList();
    }
}
