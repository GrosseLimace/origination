using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class CommodityRepository : ICommodityRepository
{
    private readonly OriginationDbContext _context;
    private readonly ApplicationDbContext _appContext;

    public CommodityRepository(OriginationDbContext context, ApplicationDbContext appContext)
    {
        _context = context;
        _appContext = appContext;
    }

    public async Task<IReadOnlyList<Commodity>> GetActiveAsync(CancellationToken cancellationToken)
    {
        return await _appContext.Commodities
            .AsNoTracking()
            .Where(c => c.IsActive)
            .OrderBy(c => c.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Commodity>> GetPlantingAsync(CancellationToken cancellationToken)
    {
        return await _appContext.Commodities
            .AsNoTracking()
            .Where(c => c.IsActive && c.ShowInPlantingIntentions)
            .OrderBy(c => c.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<CommodityConversion>> GetConversionsAsync(CancellationToken cancellationToken)
    {
        return await _context.CommodityConversions
            .AsNoTracking()
            .Where(c => c.LbsPerUnit > 0)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<HarvestWindow>> GetHarvestWindowsAsync(CancellationToken cancellationToken)
    {
        return await _appContext.HarvestWindows
            .AsNoTracking()
            .Where(h => h.IsActive)
            .ToListAsync(cancellationToken);
    }

    public async Task<int> SyncAsync(CancellationToken cancellationToken)
    {
        var existingCodesList = await _appContext.Commodities
            .Where(c => c.IsActive)
            .Select(c => c.Code)
            .ToListAsync(cancellationToken);

        var existingCodes = new HashSet<string>(existingCodesList, StringComparer.OrdinalIgnoreCase);

        // Pull all commodity data from contracts (Code, Name, Category)
        var contractCommodities = await _context.Contracts
            .AsNoTracking()
            .Where(c => c.IsActive && c.ContractPrefixType == "P"
                && !string.IsNullOrEmpty(c.CommodityCode)
                && !string.IsNullOrEmpty(c.CommodityDescription))
            .Select(c => new { c.CommodityCode, c.CommodityDescription, c.CommodityGroup })
            .Distinct()
            .ToListAsync(cancellationToken);

        // Pull all distinct product codes from tickets
        var ticketProductCodes = await _context.Tickets
            .AsNoTracking()
            .Where(t => (t.TicketType == "U" || t.TicketType == "P") && !string.IsNullOrEmpty(t.ProductCode))
            .Select(t => t.ProductCode!)
            .Distinct()
            .ToListAsync(cancellationToken);

        // Build lookup from contracts for description and category
        var contractLookup = contractCommodities
            .GroupBy(c => c.CommodityCode!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        bool changed = false;

        // New rows are inserted with TradeGroupScope left null (visible to everyone) and
        // ShowInPlantingIntentions false. This sync is additive-only: it must never write either
        // column, so hand-curated visibility survives every re-sync.
        // Add any contract commodities not yet in the table
        foreach (var item in contractCommodities)
        {
            if (!existingCodes.Contains(item.CommodityCode!))
            {
                _appContext.Commodities.Add(new Commodity
                {
                    Code = item.CommodityCode!,
                    Name = item.CommodityDescription!,
                    Category = item.CommodityGroup,
                    IsActive = true
                });
                existingCodes.Add(item.CommodityCode!);
                changed = true;
            }
        }

        // Add any ticket product codes not already covered by contracts
        foreach (var productCode in ticketProductCodes)
        {
            if (!existingCodes.Contains(productCode))
            {
                contractLookup.TryGetValue(productCode, out var match);
                _appContext.Commodities.Add(new Commodity
                {
                    Code = productCode,
                    Name = match?.CommodityDescription ?? productCode,
                    Category = match?.CommodityGroup,
                    IsActive = true
                });
                existingCodes.Add(productCode);
                changed = true;
            }
        }

        // Backfill Category for any commodities missing it
        var allCommodities = await _appContext.Commodities.Where(c => c.IsActive).ToListAsync(cancellationToken);
        foreach (var commodity in allCommodities.Where(c => string.IsNullOrEmpty(c.Category)))
        {
            if (contractLookup.TryGetValue(commodity.Code, out var match)
                && !string.IsNullOrEmpty(match.CommodityGroup))
            {
                commodity.Category = match.CommodityGroup;
                changed = true;
            }
        }

        if (changed)
        {
            await _appContext.SaveChangesAsync(cancellationToken);
        }
        return allCommodities.Count;
    }
}
