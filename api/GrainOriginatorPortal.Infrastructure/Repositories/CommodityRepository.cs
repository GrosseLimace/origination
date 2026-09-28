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

}
