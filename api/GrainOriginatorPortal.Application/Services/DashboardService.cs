using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class DashboardService : IDashboardService
{
    private readonly IDashboardRepository _repository;
    private readonly IRequestContextService _requestContext;
    private readonly IUserEntitlementService _entitlementService;

    public DashboardService(
        IDashboardRepository repository,
        IRequestContextService requestContext,
        IUserEntitlementService entitlementService)
    {
        _repository = repository;
        _requestContext = requestContext;
        _entitlementService = entitlementService;
    }

    /// <inheritdoc />
    public async Task<DashboardSummaryResponse> GetSummaryAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken)
    {
        // EF Core DbContext is not thread-safe — run sequentially. Small app tables, so sequential
        // is still far faster than 3 client round-trips. Actual harvest is the prior year.
        var estimates = await _repository.GetPlantingEstimatesAsync(tradeUnitKey, plantingYear, cancellationToken);
        var marketShares = await _repository.GetMarketSharesAsync(tradeUnitKey, plantingYear, cancellationToken);
        var actualHarvest = await _repository.GetActualHarvestAsync(tradeUnitKey, plantingYear - 1, cancellationToken);

        return new DashboardSummaryResponse
        {
            Estimates = estimates.Select(e => e.ToResponse()).ToList(),
            MarketShares = marketShares.Select(m => m.ToResponse()).ToList(),
            ActualHarvest = actualHarvest.Select(h => h.ToResponse()).ToList(),
        };
    }

    /// <inheritdoc />
    public async Task<List<DashboardPlantingEstimateResponse>> GetPlantingEstimatesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken)
    {
        var rows = await _repository.GetPlantingEstimatesAsync(tradeUnitKey, plantingYear, cancellationToken);
        return rows.Select(e => e.ToResponse()).ToList();
    }

    /// <inheritdoc />
    public Task UpsertPlantingEstimatesAsync(List<UpsertDashboardEstimateRequest> estimates, CancellationToken cancellationToken) =>
        _repository.UpsertPlantingEstimatesAsync(
            estimates.Select(r => new DashboardPlantingEstimate
            {
                TradeUnitKey = r.TradeUnitKey,
                Crop = r.Crop,
                PlantingYear = r.PlantingYear,
                YieldEstimate = r.YieldEstimate
            }).ToList(),
            _requestContext.GetCurrentUser(), cancellationToken);

    /// <inheritdoc />
    public async Task<List<DashboardMarketShareResponse>> GetMarketSharesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken)
    {
        var rows = await _repository.GetMarketSharesAsync(tradeUnitKey, plantingYear, cancellationToken);
        return rows.Select(m => m.ToResponse()).ToList();
    }

    /// <inheritdoc />
    public Task UpsertMarketSharesAsync(List<UpsertDashboardMarketShareRequest> shares, CancellationToken cancellationToken) =>
        _repository.UpsertMarketSharesAsync(
            shares.Select(r => new DashboardMarketShare
            {
                TradeUnitKey = r.TradeUnitKey,
                CropCategory = r.CropCategory,
                PlantingYear = r.PlantingYear,
                MarketSharePct = r.MarketSharePct
            }).ToList(),
            _requestContext.GetCurrentUser(), cancellationToken);

    /// <inheritdoc />
    public async Task<List<DashboardActualHarvestResponse>> GetActualHarvestAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken)
    {
        var rows = await _repository.GetActualHarvestAsync(tradeUnitKey, plantingYear, cancellationToken);
        return rows.Select(h => h.ToResponse()).ToList();
    }

    /// <inheritdoc />
    public Task UpsertActualHarvestAsync(List<UpsertDashboardActualHarvestRequest> items, CancellationToken cancellationToken) =>
        _repository.UpsertActualHarvestAsync(
            items.Select(r => new DashboardActualHarvest
            {
                TradeUnitKey = r.TradeUnitKey,
                CropCategory = r.CropCategory,
                PlantingYear = r.PlantingYear,
                Bushels = r.Bushels
            }).ToList(),
            _requestContext.GetCurrentUser(), cancellationToken);

    /// <inheritdoc />
    public async Task<string?> DeleteActualHarvestAsync(int id, CancellationToken cancellationToken)
    {
        // H-061 (CWE-639). This route carries no trade-unit value, so the controller's
        // [EnforceTradeUnitAccess] filter has nothing to evaluate and passes it straight through —
        // it only inspects a `tradeUnits` / `tradeUnitKey` argument or a [FromBody] DTO. The row
        // itself IS trade-unit-keyed, so resolve the owning trade unit and authorize against the
        // caller's entitlements before removing anything.
        //
        // Deliberately NOT covered by AR-01: that entry is about shared *producer* records (notes,
        // planting intentions, producer details) where cross-trade-unit coverage is the point.
        // Actual-harvest rows are trade-unit-keyed dashboard aggregates feeding the market-share
        // calculation, they are hand-entered with no upstream system of record to restore from,
        // and every sibling route on this controller is already trade-unit scoped.
        var tradeUnitKey = await _repository.GetActualHarvestTradeUnitKeyAsync(id, cancellationToken);

        // Unchanged, idempotent behaviour for an id that does not exist: no-op, no 403. Returning a
        // 403 here would also turn the route into an existence oracle for other trade units' ids.
        if (string.IsNullOrWhiteSpace(tradeUnitKey))
            return null;

        // Fail CLOSED on an entitlements outage rather than deleting data we cannot authorize
        // (CWE-285) — mirrors EnforceTradeUnitAccessAttribute and DpContractService.
        await _entitlementService.GetAllowedTradeUnitCodesAsync(cancellationToken);
        if (!_entitlementService.EntitlementsAvailable)
            throw new InfrastructureException(
                "Authorization data is temporarily unavailable. Please retry shortly.",
                "ENTITLEMENTS_DB_UNAVAILABLE", StatusCodes.Status503ServiceUnavailable);

        await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitKey], cancellationToken);

        await _repository.DeleteActualHarvestAsync(id, cancellationToken);
        return tradeUnitKey;
    }
}
