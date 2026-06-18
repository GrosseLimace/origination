using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Persistence for customer notes (dbo.Notes, soft-deleted). CustomerName/CustomerCode are
/// composed from the Customer FK join (those columns were dropped from the table). CreatedBy/
/// ModifiedBy display-name enrichment is done by the caller; the owning user is passed in.
/// </summary>
public interface INoteRepository
{
    Task<List<Note>> GetAsync(IEnumerable<string>? tradeUnits, CancellationToken cancellationToken);
    Task<List<Note>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);
    Task<Note?> GetByIdAsync(long noteId, CancellationToken cancellationToken);
    Task<Note> AddAsync(long customerId, string content, string? tradeUnit, string currentUser, CancellationToken cancellationToken);
    Task<Note?> TogglePinAsync(long noteId, CancellationToken cancellationToken);
    Task<Note?> UpdateAsync(long noteId, string content, string currentUser, CancellationToken cancellationToken);
    Task DeleteAsync(long noteId, string currentUser, CancellationToken cancellationToken);
}
