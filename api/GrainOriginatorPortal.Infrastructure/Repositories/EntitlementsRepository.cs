using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class EntitlementsRepository : IEntitlementsRepository
{
    private readonly EntitlementsDbContext _entitlementsContext;
    private readonly OriginationDbContext _odsContext;

    public EntitlementsRepository(EntitlementsDbContext entitlementsContext, OriginationDbContext odsContext)
    {
        _entitlementsContext = entitlementsContext;
        _odsContext = odsContext;
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

    public async Task<List<string>> GetTradeUnitCodesForUserAsync(string userId, CancellationToken cancellationToken)
    {
        return await _entitlementsContext.UserTradeUnitAccess
            .Where(u => u.UserId == userId)
            .Select(u => u.TradeUnitCode)
            .Distinct()
            .ToListAsync(cancellationToken);
    }

    public async Task<List<string>> GetCustomerTradeUnitCodesAsync(long customerId, CancellationToken cancellationToken)
    {
        return (await _odsContext.CustomerTradeUnits
            .Where(c => c.CustomerId == customerId)
            .Select(c => c.TradeUnit)
            .Where(tu => tu != null)
            .Distinct()
            .ToListAsync(cancellationToken))!;
    }
}
