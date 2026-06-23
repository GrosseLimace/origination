using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>Persistence for a user's saved customer lists. The owning user id is supplied by the
/// caller (read from the request context) — the repository stays free of HttpContext.</summary>
public interface ISavedListRepository
{
    /// <summary>Active saved lists owned by the given user, newest first.</summary>
    Task<List<SavedList>> GetByUserAsync(string userId, CancellationToken cancellationToken);

    /// <summary>Persists a new saved list (built by the caller).</summary>
    Task AddAsync(SavedList list, CancellationToken cancellationToken);

    /// <summary>Updates an owned saved list's fields; returns the updated entity, or null if not found / not owned.</summary>
    Task<SavedList?> UpdateAsync(int listId, string userId, string name, string query, string? tradeUnits,
        string? filters, string? includedCustomerIds, string? excludedCustomerIds, CancellationToken cancellationToken);

    /// <summary>Deletes an owned saved list (no-op if not found / not owned).</summary>
    Task DeleteAsync(int listId, string userId, CancellationToken cancellationToken);
}
