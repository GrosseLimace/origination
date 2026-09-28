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
        // Customer name/code come from the authoritative dbo.Customer row rather than the client. The
        // trade unit is the originator's choice — a producer on several trade units plants different
        // acres for each — validated against the producer's memberships in ResolveTradeUnitAsync.
        var customer = await _customerRepository.GetByIdAsync(customerId, cancellationToken);

        var resolvedName = customer?.Name ?? customerName ?? string.Empty;
        var resolvedCode = customer?.ScoularId ?? customerCode ?? string.Empty;
        var resolvedTradeUnit = await ResolveTradeUnitAsync(customerId, tradeUnit, customer is not null, crop, cancellationToken);

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
        string? description, int acres, int plantingYear, string? tradeUnit, CancellationToken cancellationToken)
    {
        // Blank = "don't change the trade unit" (older clients and edits that only touch acres).
        string? resolvedTradeUnit = null;
        if (!string.IsNullOrWhiteSpace(tradeUnit))
        {
            var existing = await _repository.GetByIdAsync(intentionId, cancellationToken);
            if (existing is null) return null;
            resolvedTradeUnit = await ResolveTradeUnitAsync(existing.CustomerId, tradeUnit, customerFound: true, crop, cancellationToken);
        }

        var intention = await _repository.UpdateAsync(intentionId, crop, category, type, description, acres,
            plantingYear, resolvedTradeUnit, _requestContext.GetCurrentUser(), cancellationToken);
        if (intention is null) return null;

        var nameMap = await _displayNameLookup.ResolveAsync(
            new[] { intention.CreatedBy, intention.ModifiedBy ?? string.Empty }, cancellationToken);
        return intention.ToResponse(nameMap);
    }

    /// <summary>
    /// Decides which trade unit a planting-intention row is recorded under.
    /// <list type="bullet">
    ///   <item>Caller chose one and the producer has memberships: it must be one of them, else 400.
    ///     This is a data-integrity rule (a row can only belong to a trade unit the producer trades
    ///     with), not an access check — trade units are a UX default, not a boundary (AR-01/AR-02),
    ///     so any originator may record acres for any of the producer's trade units.</item>
    ///   <item>Caller chose one and the producer has no membership rows (contracts-only / not yet
    ///     synced): accept it.</item>
    ///   <item>Caller chose nothing: the producer's first membership by code (deterministic), else 400.</item>
    /// </list>
    /// </summary>
    private async Task<string> ResolveTradeUnitAsync(long customerId, string? requestedTradeUnit, bool customerFound,
        string crop, CancellationToken cancellationToken)
    {
        var producerTradeUnits = await _customerRepository.GetActiveTradeUnitCodesAsync(customerId, cancellationToken);
        var requested = requestedTradeUnit?.Trim();

        if (!string.IsNullOrEmpty(requested))
        {
            if (producerTradeUnits.Count == 0)
            {
                _logger.LogInformation(
                    "Planting intention trade unit {TradeUnit} accepted for CustomerId={CustomerId} with no membership rows (contracts-only producer)",
                    requested, customerId);
                return requested;
            }

            var match = producerTradeUnits.FirstOrDefault(tu => string.Equals(tu, requested, StringComparison.OrdinalIgnoreCase));
            if (match is not null) return match;

            _logger.LogWarning(
                "Planting intention rejected — trade unit {TradeUnit} is not one of the producer's. CustomerId={CustomerId}, ProducerTradeUnits={ProducerTradeUnits}, Crop={Crop}",
                requested, customerId, string.Join(",", producerTradeUnits), crop);
            throw new ValidationException("tradeUnit",
                $"Trade unit {requested} is not one of this producer's trade units ({string.Join(", ", producerTradeUnits)}).");
        }

        var fallback = producerTradeUnits.FirstOrDefault();
        if (fallback is null)
        {
            // Capture the actual cause of a "save fails the first time" report: records whether the
            // customer row existed and that the client supplied nothing.
            _logger.LogWarning(
                "Planting intention create rejected — no trade unit. CustomerId={CustomerId}, CustomerFound={CustomerFound}, ClientTradeUnit=(none), Crop={Crop}",
                customerId, customerFound, crop);
            throw new ValidationException("tradeUnit",
                "Trade unit could not be determined for this customer. Please select a trade unit and try again.");
        }

        if (producerTradeUnits.Count > 1)
        {
            _logger.LogInformation(
                "Planting intention for multi-trade-unit CustomerId={CustomerId} saved without a chosen trade unit; defaulted to {TradeUnit} of {ProducerTradeUnits}",
                customerId, fallback, string.Join(",", producerTradeUnits));
        }
        return fallback;
    }

    /// <inheritdoc />
    public async Task<int> RetagAsync(long customerId, string fromTradeUnit, string toTradeUnit, CancellationToken cancellationToken)
    {
        var from = (fromTradeUnit ?? string.Empty).Trim();
        if (from.Length == 0)
            throw new ValidationException("fromTradeUnit", "The trade unit to move planting intentions from is required.");

        // Validates the target against the producer's active trade units (same rule as create/update).
        // The source is deliberately unchecked — the producer has usually just been removed from it.
        var to = await ResolveTradeUnitAsync(customerId, toTradeUnit, customerFound: true, crop: "(retag)", cancellationToken);
        if (string.Equals(from, to, StringComparison.OrdinalIgnoreCase)) return 0;

        // The controller writes the AUDIT_UPDATE line for this call, as it does for create/update/delete.
        return await _repository.RetagAsync(customerId, from, to, _requestContext.GetCurrentUser(), cancellationToken);
    }

    /// <inheritdoc />
    public Task DeleteAsync(int intentionId, CancellationToken cancellationToken) =>
        _repository.DeleteAsync(intentionId, _requestContext.GetCurrentUser(), cancellationToken);

    private async Task<List<PlantingIntentionResponse>> MapWithNamesAsync(List<PlantingIntention> intentions, CancellationToken cancellationToken)
    {
        var nameMap = await _displayNameLookup.ResolveAsync(
            intentions.Select(i => i.CreatedBy).Concat(intentions.Select(i => i.ModifiedBy ?? string.Empty)),
            cancellationToken);
        return intentions.Select(i => i.ToResponse(nameMap)).ToList();
    }
}
