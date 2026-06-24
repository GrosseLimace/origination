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
        // The caller's "My Lists": lists they created that have NOT been assigned away (AssignedTo == null),
        // plus any list a manager assigned to them (AssignedTo == their UPN). Keeping assigned-away
        // copies out of the creator's view stops the manager's own list from filling with the copies they hand out.
        return await _appContext.SavedLists
            .AsNoTracking()
            .Where(s => s.IsActive && ((s.CreatedBy == userId && s.AssignedTo == null) || s.AssignedTo == userId))
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<SavedList>> GetByTradeUnitsAsync(IReadOnlyCollection<string> tradeUnits, string excludeUser, CancellationToken cancellationToken)
    {
        if (tradeUnits.Count == 0) return new List<SavedList>();

        // A list's effective OWNER is AssignedTo (the team member it was built for) when set, else
        // CreatedBy. "Team Lists" shows lists owned by a team member other than the caller — including
        // copies the caller assigned to others (AssignedTo set, CreatedBy == caller) — but excludes the
        // caller's own personal lists and lists assigned TO the caller (those live in their My Lists).
        // CSV overlap is matched in memory (TradeUnits is denormalized; per-TU volume is small).
        var candidates = await _appContext.SavedLists
            .AsNoTracking()
            .Where(s => s.IsActive && s.TradeUnits != null)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync(cancellationToken);

        var requested = new HashSet<string>(tradeUnits, StringComparer.OrdinalIgnoreCase);
        return candidates
            .Where(s => !OwnedByCaller(s, excludeUser))
            .Where(s => s.TradeUnits!
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Any(requested.Contains))
            .ToList();
    }

    /// <summary>True when the list's effective owner is the caller: an assigned list is owned by its
    /// recipient (<c>AssignedTo</c> == caller UPN); a normal list is owned by its creator.</summary>
    private static bool OwnedByCaller(SavedList s, string callerUserId) =>
        string.Equals(string.IsNullOrEmpty(s.AssignedTo) ? s.CreatedBy : s.AssignedTo,
            callerUserId, StringComparison.OrdinalIgnoreCase);

    public Task<SavedList?> GetByIdAsync(int listId, CancellationToken cancellationToken) =>
        _appContext.SavedLists.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == listId && s.IsActive, cancellationToken);

    public async Task AddAsync(SavedList list, CancellationToken cancellationToken)
    {
        _appContext.SavedLists.Add(list);
        await _appContext.SaveChangesAsync(cancellationToken);
    }

    public async Task AddRangeAsync(IEnumerable<SavedList> lists, CancellationToken cancellationToken)
    {
        _appContext.SavedLists.AddRange(lists);
        await _appContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<SavedList?> UpdateAsync(int listId, string userId, bool canManageAny, string name, string query, string? tradeUnits,
        string? filters, string? includedCustomerIds, string? excludedCustomerIds, CancellationToken cancellationToken)
    {
        var list = await _appContext.SavedLists.FirstOrDefaultAsync(
            s => s.Id == listId && (canManageAny || s.CreatedBy == userId || s.AssignedTo == userId), cancellationToken);
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
            s => s.Id == listId && (canManageAny || s.CreatedBy == userId || s.AssignedTo == userId), cancellationToken);
        if (list == null) return;
        _appContext.SavedLists.Remove(list);
        await _appContext.SaveChangesAsync(cancellationToken);
    }
}
