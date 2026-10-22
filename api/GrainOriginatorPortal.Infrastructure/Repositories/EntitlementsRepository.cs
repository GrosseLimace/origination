using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class EntitlementsRepository : IEntitlementsRepository
{
    private readonly TradeUnitPreferencesDbContext _entitlementsContext;
    private readonly ApplicationDbContext _appContext;

    public EntitlementsRepository(TradeUnitPreferencesDbContext entitlementsContext, ApplicationDbContext appContext)
    {
        _entitlementsContext = entitlementsContext;
        _appContext = appContext;
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
        var codes = await _appContext.CustomerTradeUnits.AsNoTracking()
            .Where(t => t.CustomerId == customerId && t.IsActive)
            .Select(t => t.TradeUnit).ToListAsync(cancellationToken);
        return codes.Select(c => c.Trim()).Where(c => c.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    public async Task<HashSet<string>> GetActiveUserIdsAsync(IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        if (userIds.Count == 0) return new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        // Filtered on the ids actually asked about rather than loading the roster: a note carries a
        // handful of mentions, and the Logic App's equivalent lookup already has to cap itself at
        // 2000 rows to fetch the whole list.
        var matches = await _entitlementsContext.Users
            .AsNoTracking()
            .Where(u => u.IsActive && userIds.Contains(u.UserId))
            .Select(u => u.UserId)
            .ToListAsync(cancellationToken);

        return matches.ToHashSet(StringComparer.OrdinalIgnoreCase);
    }
}
