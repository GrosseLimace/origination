using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Persistence for customer notes (dbo.Notes, soft-deleted). CustomerName/CustomerCode are
/// composed from the Customer FK join (those columns were dropped from the table). CreatedBy/
/// ModifiedBy display-name enrichment is done by the caller; the owning user is passed in.
/// </summary>
public interface INoteRepository
{
    Task<List<Note>> GetAsync(
        IEnumerable<string>? tradeUnits,
        DateTime? createdSinceUtc,
        IReadOnlyList<string>? contentAny,
        IReadOnlyList<string>? authorAny,
        bool pinnedOnly,
        IReadOnlyList<long>? customerIds,
        CancellationToken cancellationToken);

    /// <summary>
    /// Per-customer MAX(CreatedAt) over ALL non-deleted notes — the lightweight feed for the
    /// customer list's "last contacted" badges. Not trade-unit-filtered: notes are open per
    /// producer (matches GetByCustomerAsync), so the badge reflects the true latest contact
    /// regardless of a note's TradeUnit tag. Trade-unit scoping happens on the customers query.
    /// </summary>
    Task<List<NoteLastContact>> GetLastContactAsync(CancellationToken cancellationToken);
    Task<List<Note>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);
    Task<Note?> GetByIdAsync(long noteId, CancellationToken cancellationToken);
    Task<Note> AddAsync(long customerId, string content, string? tradeUnit, string? mentionsJson, string currentUser, CancellationToken cancellationToken);
    Task<Note?> TogglePinAsync(long noteId, CancellationToken cancellationToken);
    /// <param name="replaceMentions">False leaves the note's existing Mentions untouched (the caller
    /// sent none); true writes <paramref name="mentionsJson"/>, where null CLEARS them.</param>
    Task<Note?> UpdateAsync(long noteId, string content, string? mentionsJson, bool replaceMentions, string currentUser, CancellationToken cancellationToken);
    Task DeleteAsync(long noteId, string currentUser, CancellationToken cancellationToken);
}
