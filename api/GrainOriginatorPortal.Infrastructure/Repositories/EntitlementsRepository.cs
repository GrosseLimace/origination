using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class EntitlementsRepository : IEntitlementsRepository
{
    private readonly EntitlementsDbContext _entitlementsContext;

    public EntitlementsRepository(EntitlementsDbContext entitlementsContext)
    {
        _entitlementsContext = entitlementsContext;
    }

    public async Task<List<UserTradeUnitAccess>> GetByUserAsync(string userId, CancellationToken cancellationToken)
    {
        return await _entitlementsContext.UserTradeUnitAccess
            .AsNoTracking()
            .Where(u => u.UserId == userId)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<UserTradeUnitAccess>> GetAllAsync(CancellationToken cancellationToken)
    {
        return await _entitlementsContext.UserTradeUnitAccess
            .AsNoTracking()
            .Where(u => u.TradeUnitCode != null && u.TradeUnitCode != "")
            .ToListAsync(cancellationToken);
    }
}
