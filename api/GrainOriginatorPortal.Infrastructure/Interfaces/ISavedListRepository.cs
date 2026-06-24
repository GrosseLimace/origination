using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>Persistence for a user's saved customer lists. The owning user id is supplied by the
/// caller (read from the request context) — the repository stays free of HttpContext.</summary>
public interface ISavedListRepository
{
    /// <summary>Active saved lists the user can see in their own "My Lists", newest first: lists they
    /// created (and have not been assigned away), plus lists a manager assigned to them
    /// (<c>AssignedTo</c> == <paramref name="userId"/>). <paramref name="userId"/> is the full UPN.</summary>
    Task<List<SavedList>> GetByUserAsync(string userId, CancellationToken cancellationToken);

    /// <summary>Active saved lists owned by a team member <em>other than</em> the caller, whose trade-unit
    /// set overlaps any of <paramref name="tradeUnits"/>, newest first. A list's owner is its
    /// <c>AssignedTo</c> recipient when set, else its <c>CreatedBy</c> — so copies the caller assigned to
    /// others appear here ("for [member]") while the caller's own and assigned-to-caller lists do not.
    /// <paramref name="excludeUser"/> is the caller's full UPN.</summary>
    Task<List<SavedList>> GetByTradeUnitsAsync(IReadOnlyCollection<string> tradeUnits, string excludeUser, CancellationToken cancellationToken);

    /// <summary>Persists a new saved list (built by the caller).</summary>
    Task AddAsync(SavedList list, CancellationToken cancellationToken);

    /// <summary>Persists several saved lists in a single save — used when a manager assigns a copy of a
    /// list to multiple team members at once.</summary>
    Task AddRangeAsync(IEnumerable<SavedList> lists, CancellationToken cancellationToken);

    /// <summary>Updates a saved list's fields; returns the updated entity, or null if not found.
    /// When <paramref name="canManageAny"/> is false the update is restricted to lists the caller owns
    /// (<c>CreatedBy</c> == <paramref name="userId"/>) or that were assigned to them
    /// (<c>AssignedTo</c> == <paramref name="userId"/>); when true (manager) any list may be updated.
    /// <c>ModifiedBy</c> is always set to <paramref name="userId"/> so the audit trail records the actual editor.</summary>
    Task<SavedList?> UpdateAsync(int listId, string userId, bool canManageAny, string name, string query, string? tradeUnits,
        string? filters, string? includedCustomerIds, string? excludedCustomerIds, CancellationToken cancellationToken);

    /// <summary>Deletes a saved list (no-op if not found). When <paramref name="canManageAny"/> is false the
    /// delete is restricted to lists the caller owns (<c>CreatedBy</c> == <paramref name="userId"/>) or that
    /// were assigned to them (<c>AssignedTo</c> == <paramref name="userId"/>); when true (manager) any list may be deleted.</summary>
    Task DeleteAsync(int listId, string userId, bool canManageAny, CancellationToken cancellationToken);
}
