using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class DashboardRepository : IDashboardRepository
{
    private readonly ApplicationDbContext _appContext;

    public DashboardRepository(ApplicationDbContext appContext)
    {
        _appContext = appContext;
    }

    public async Task<List<DashboardPlantingEstimate>> GetPlantingEstimatesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken)
    {
        return await _appContext.DashboardPlantingEstimates
            .AsNoTracking()
            .Where(e => e.TradeUnitKey == tradeUnitKey && e.PlantingYear == plantingYear)
            .OrderBy(e => e.Crop)
            .ToListAsync(cancellationToken);
    }

    public async Task UpsertPlantingEstimatesAsync(List<DashboardPlantingEstimate> estimates, string username, CancellationToken cancellationToken)
    {
        if (estimates.Count == 0) return;
        var strategy = _appContext.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await _appContext.Database.BeginTransactionAsync(cancellationToken);

            // Load all existing records for this TU+year in one query, then do in-memory lookup.
            // Use OrdinalIgnoreCase on the dictionary because SQL Server's default collation is
            // case-insensitive — a DB row stored as "Irrigated corn" must match a request for
            // "Irrigated Corn" on the .NET side too, or the update branch is skipped and the
            // insert branch then trips the unique key constraint on (TradeUnitKey, Crop, Year).
            // Scope the lookup per (trade unit, year) actually present in the batch. Keying off
            // estimates[0] alone assumed every element shared the first one's TU/year; an element
            // for any other TU/year would miss its existing row, take the insert branch and trip
            // the unique index — rolling back the whole batch, correctly-scoped rows included.
            foreach (var scope in estimates.GroupBy(e => (e.TradeUnitKey, e.PlantingYear)))
            {
                var tuKey = scope.Key.TradeUnitKey;
                var year = scope.Key.PlantingYear;
                var existingMap = await _appContext.DashboardPlantingEstimates
                    .Where(e => e.TradeUnitKey == tuKey && e.PlantingYear == year)
                    .ToDictionaryAsync(e => e.Crop, StringComparer.OrdinalIgnoreCase, cancellationToken);

                foreach (var req in scope)
                {
                    existingMap.TryGetValue(req.Crop, out var existing);
                    if (req.YieldEstimate == null)
                    {
                        if (existing != null)
                            _appContext.DashboardPlantingEstimates.Remove(existing);
                    }
                    else if (existing != null)
                    {
                        existing.YieldEstimate = req.YieldEstimate;
                        // Normalize the stored Crop casing to match the request — the unique index
                        // is case-insensitive so this doesn't violate anything, and keeping the DB
                        // in sync with the Commodities table's display casing means the UI can find
                        // the value when it re-fetches after save.
                        existing.Crop = req.Crop;
                        existing.ModifiedAt = DateTime.UtcNow;
                        existing.ModifiedBy = username;
                    }
                    else
                    {
                        _appContext.DashboardPlantingEstimates.Add(new DashboardPlantingEstimate
                        {
                            TradeUnitKey = req.TradeUnitKey,
                            Crop = req.Crop,
                            PlantingYear = req.PlantingYear,
                            YieldEstimate = req.YieldEstimate,
                            CreatedAt = DateTime.UtcNow,
                            CreatedBy = username
                        });
                    }
                }
            }
            await _appContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
    }

    public async Task<List<DashboardMarketShare>> GetMarketSharesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken)
    {
        return await _appContext.DashboardMarketShares
            .AsNoTracking()
            .Where(e => e.TradeUnitKey == tradeUnitKey && e.PlantingYear == plantingYear)
            .OrderBy(e => e.CropCategory)
            .ToListAsync(cancellationToken);
    }

    public async Task UpsertMarketSharesAsync(List<DashboardMarketShare> shares, string username, CancellationToken cancellationToken)
    {
        if (shares.Count == 0) return;
        var strategy = _appContext.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await _appContext.Database.BeginTransactionAsync(cancellationToken);

            // OrdinalIgnoreCase — SQL collation is case-insensitive, so the dictionary must match.
            // Grouped per (trade unit, year) for the same reason as the estimates upsert above.
            foreach (var scope in shares.GroupBy(e => (e.TradeUnitKey, e.PlantingYear)))
            {
                var tuKey = scope.Key.TradeUnitKey;
                var year = scope.Key.PlantingYear;
                var existingMap = await _appContext.DashboardMarketShares
                    .Where(e => e.TradeUnitKey == tuKey && e.PlantingYear == year)
                    .ToDictionaryAsync(e => e.CropCategory, StringComparer.OrdinalIgnoreCase, cancellationToken);

                foreach (var req in scope)
                {
                    existingMap.TryGetValue(req.CropCategory, out var existing);
                    if (req.MarketSharePct == null)
                    {
                        if (existing != null)
                            _appContext.DashboardMarketShares.Remove(existing);
                    }
                    else if (existing != null)
                    {
                        existing.MarketSharePct = req.MarketSharePct;
                        existing.CropCategory = req.CropCategory;  // normalize casing to match request
                        existing.ModifiedAt = DateTime.UtcNow;
                        existing.ModifiedBy = username;
                    }
                    else
                    {
                        _appContext.DashboardMarketShares.Add(new DashboardMarketShare
                        {
                            TradeUnitKey = req.TradeUnitKey,
                            CropCategory = req.CropCategory,
                            PlantingYear = req.PlantingYear,
                            MarketSharePct = req.MarketSharePct,
                            CreatedAt = DateTime.UtcNow,
                            CreatedBy = username
                        });
                    }
                }
            }
            await _appContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
    }

    public async Task<List<DashboardActualHarvest>> GetActualHarvestAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken)
    {
        return await _appContext.DashboardActualHarvests
            .AsNoTracking()
            .Where(e => e.TradeUnitKey == tradeUnitKey && e.PlantingYear == plantingYear)
            .OrderBy(e => e.CropCategory)
            .ToListAsync(cancellationToken);
    }

    public async Task UpsertActualHarvestAsync(List<DashboardActualHarvest> items, string username, CancellationToken cancellationToken)
    {
        if (items.Count == 0) return;
        var strategy = _appContext.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await _appContext.Database.BeginTransactionAsync(cancellationToken);

            // OrdinalIgnoreCase — SQL collation is case-insensitive, so the dictionary must match.
            // Grouped per (trade unit, year) for the same reason as the estimates upsert above.
            foreach (var scope in items.GroupBy(e => (e.TradeUnitKey, e.PlantingYear)))
            {
                var tuKey = scope.Key.TradeUnitKey;
                var year = scope.Key.PlantingYear;
                var existingMap = await _appContext.DashboardActualHarvests
                    .Where(e => e.TradeUnitKey == tuKey && e.PlantingYear == year)
                    .ToDictionaryAsync(e => e.CropCategory, StringComparer.OrdinalIgnoreCase, cancellationToken);

                foreach (var req in scope)
                {
                    existingMap.TryGetValue(req.CropCategory, out var existing);
                    if (existing != null)
                    {
                        existing.Bushels = req.Bushels;
                        existing.CropCategory = req.CropCategory;  // normalize casing to match request
                        existing.ModifiedAt = DateTime.UtcNow;
                        existing.ModifiedBy = username;
                    }
                    else
                    {
                        _appContext.DashboardActualHarvests.Add(new DashboardActualHarvest
                        {
                            TradeUnitKey = req.TradeUnitKey,
                            CropCategory = req.CropCategory,
                            PlantingYear = req.PlantingYear,
                            Bushels = req.Bushels,
                            CreatedAt = DateTime.UtcNow,
                            CreatedBy = username
                        });
                    }
                }
            }
            await _appContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
    }

    public Task<string?> GetActualHarvestTradeUnitKeyAsync(int id, CancellationToken cancellationToken) =>
        _appContext.DashboardActualHarvests
            .AsNoTracking()
            .Where(e => e.Id == id)
            .Select(e => e.TradeUnitKey)
            .FirstOrDefaultAsync(cancellationToken);

    public async Task DeleteActualHarvestAsync(int id, CancellationToken cancellationToken)
    {
        var entity = await _appContext.DashboardActualHarvests.FindAsync([id], cancellationToken);
        if (entity != null)
        {
            _appContext.DashboardActualHarvests.Remove(entity);
            await _appContext.SaveChangesAsync(cancellationToken);
        }
    }
}
