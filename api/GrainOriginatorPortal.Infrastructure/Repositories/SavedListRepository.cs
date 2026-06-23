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

    public async Task AddAsync(SavedList list, CancellationToken cancellationToken)
    {
        _appContext.SavedLists.Add(list);
        await _appContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<SavedList?> UpdateAsync(int listId, string userId, string name, string query, string? tradeUnits,
        string? filters, string? includedCustomerIds, string? excludedCustomerIds, CancellationToken cancellationToken)
    {
        var list = await _appContext.SavedLists.FirstOrDefaultAsync(s => s.Id == listId && s.CreatedBy == userId, cancellationToken);
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

    public async Task DeleteAsync(int listId, string userId, CancellationToken cancellationToken)
    {
        var list = await _appContext.SavedLists.FirstOrDefaultAsync(s => s.Id == listId && s.CreatedBy == userId, cancellationToken);
        if (list == null) return;
        _appContext.SavedLists.Remove(list);
        await _appContext.SaveChangesAsync(cancellationToken);
    }
}
