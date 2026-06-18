using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class SavedListRepository : ISavedListRepository
{
    private readonly ApplicationDbContext _appContext;

    public SavedListRepository(ApplicationDbContext appContext)
    {
        _appContext = appContext;
    }

    public async Task<List<SavedList>> GetByUserAsync(string userId, CancellationToken cancellationToken)
    {
        return await _appContext.SavedLists
            .AsNoTracking()
            .Where(s => s.IsActive && s.CreatedBy == userId)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<SavedList>> GetByTradeUnitsAsync(IReadOnlyCollection<string> tradeUnits, string excludeUser, CancellationToken cancellationToken)
    {
        if (tradeUnits.Count == 0) return new List<SavedList>();

        // Narrow at the DB to active lists not owned by the caller, then do the CSV overlap match in
        // memory — TradeUnits is a denormalized comma-separated string, so exact set logic is more
        // robust client-side than a brittle SQL LIKE. Saved-list volume per trade unit is small.
        var candidates = await _appContext.SavedLists
            .AsNoTracking()
            .Where(s => s.IsActive && s.CreatedBy != excludeUser && s.TradeUnits != null)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync(cancellationToken);

        var requested = new HashSet<string>(tradeUnits, StringComparer.OrdinalIgnoreCase);
        return candidates
            .Where(s => s.TradeUnits!
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Any(requested.Contains))
            .ToList();
    }

    public async Task AddAsync(SavedList list, CancellationToken cancellationToken)
    {
        _appContext.SavedLists.Add(list);
        await _appContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<SavedList?> UpdateAsync(int listId, string userId, bool canManageAny, string name, string query, string? tradeUnits,
        string? filters, string? includedCustomerIds, string? excludedCustomerIds, CancellationToken cancellationToken)
    {
        var list = await _appContext.SavedLists.FirstOrDefaultAsync(
            s => s.Id == listId && (canManageAny || s.CreatedBy == userId), cancellationToken);
        if (list == null) return null;
        list.Name = name;
        list.Query = query;
        list.TradeUnits = tradeUnits;
        list.Filters = filters;
        list.IncludedCustomerIds = includedCustomerIds;
        list.ExcludedCustomerIds = excludedCustomerIds;
        list.ModifiedAt = DateTime.UtcNow;
        list.ModifiedBy = userId;
        await _appContext.SaveChangesAsync(cancellationToken);
        return list;
    }

    public async Task DeleteAsync(int listId, string userId, bool canManageAny, CancellationToken cancellationToken)
    {
        var list = await _appContext.SavedLists.FirstOrDefaultAsync(
            s => s.Id == listId && (canManageAny || s.CreatedBy == userId), cancellationToken);
        if (list == null) return;
        _appContext.SavedLists.Remove(list);
        await _appContext.SaveChangesAsync(cancellationToken);
    }
}
