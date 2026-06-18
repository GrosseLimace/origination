using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>Persistence for a user's saved customer lists. The owning user id is supplied by the
/// caller (read from the request context) — the repository stays free of HttpContext.</summary>
public interface ISavedListRepository
{
    /// <summary>Active saved lists owned by the given user, newest first.</summary>
    Task<List<SavedList>> GetByUserAsync(string userId, CancellationToken cancellationToken);

    /// <summary>Active saved lists created by anyone <em>other than</em> <paramref name="excludeUser"/> whose
    /// trade-unit set overlaps any of <paramref name="tradeUnits"/> (a list shows if it carries at least one
    /// of the requested TUs), newest first. Used by managers to view their team's lists.</summary>
    Task<List<SavedList>> GetByTradeUnitsAsync(IReadOnlyCollection<string> tradeUnits, string excludeUser, CancellationToken cancellationToken);

    /// <summary>Persists a new saved list (built by the caller).</summary>
    Task AddAsync(SavedList list, CancellationToken cancellationToken);

    /// <summary>Updates a saved list's fields; returns the updated entity, or null if not found.
    /// When <paramref name="canManageAny"/> is false the update is restricted to lists owned by
    /// <paramref name="userId"/>; when true (manager) any list may be updated. <c>ModifiedBy</c> is always
    /// set to <paramref name="userId"/> so the audit trail records the actual editor.</summary>
    Task<SavedList?> UpdateAsync(int listId, string userId, bool canManageAny, string name, string query, string? tradeUnits,
        string? filters, string? includedCustomerIds, string? excludedCustomerIds, CancellationToken cancellationToken);

    /// <summary>Deletes a saved list (no-op if not found). When <paramref name="canManageAny"/> is false the
    /// delete is restricted to lists owned by <paramref name="userId"/>; when true (manager) any list may be deleted.</summary>
    Task DeleteAsync(int listId, string userId, bool canManageAny, CancellationToken cancellationToken);
}
