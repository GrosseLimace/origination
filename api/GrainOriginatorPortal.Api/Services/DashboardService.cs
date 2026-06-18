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

    public DashboardService(IDashboardRepository repository, IRequestContextService requestContext)
    {
        _repository = repository;
        _requestContext = requestContext;
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
    public Task DeleteActualHarvestAsync(int id, CancellationToken cancellationToken) =>
        _repository.DeleteActualHarvestAsync(id, cancellationToken);
}
