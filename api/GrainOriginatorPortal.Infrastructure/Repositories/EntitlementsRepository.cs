using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class EntitlementsRepository : IEntitlementsRepository
{
    private readonly TradeUnitPreferencesDbContext _entitlementsContext;
    private readonly OriginationDbContext _odsContext;

    public EntitlementsRepository(TradeUnitPreferencesDbContext entitlementsContext, OriginationDbContext odsContext)
    {
        _entitlementsContext = entitlementsContext;
        _odsContext = odsContext;
    }

    public async Task<List<UserTradeUnitPreference>> GetByUserAsync(string userId, CancellationToken cancellationToken)
    {
        return await _entitlementsContext.UserTradeUnitPreferences
            .AsNoTracking()
            .Where(u => u.UserId == userId)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<UserTradeUnitPreference>> GetAllAsync(CancellationToken cancellationToken)
    {
        return await _entitlementsContext.UserTradeUnitPreferences
            .AsNoTracking()
            .Where(u => u.TradeUnitCode != null && u.TradeUnitCode != "")
            .ToListAsync(cancellationToken);
    }

    public async Task<List<UserTradeUnitPreference>> GetUsersByTradeUnitsAsync(IReadOnlyCollection<string> tradeUnitCodes, CancellationToken cancellationToken)
    {
        if (tradeUnitCodes.Count == 0) return new List<UserTradeUnitPreference>();

        return await _entitlementsContext.UserTradeUnitPreferences
            .AsNoTracking()
            .Where(u => tradeUnitCodes.Contains(u.TradeUnitCode))
            .ToListAsync(cancellationToken);
    }

    public async Task<List<string>> GetTradeUnitCodesForUserAsync(string userId, CancellationToken cancellationToken)
    {
        return await _entitlementsContext.UserTradeUnitPreferences
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
