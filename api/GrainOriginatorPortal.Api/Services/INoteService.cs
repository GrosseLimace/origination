using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Customer notes. List reads are scoped to the caller's entitled trade units; Create
/// stamps the authoritative trade unit from the customer's membership.</summary>
public interface INoteService
{
    Task<List<NoteResponse>> GetAllAsync(string? tradeUnits, CancellationToken cancellationToken);
    Task<List<NoteResponse>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);
    Task<NoteResponse?> GetByIdAsync(long noteId, CancellationToken cancellationToken);
    Task<NoteResponse> CreateAsync(long customerId, string content, CancellationToken cancellationToken);
    Task<NoteResponse?> TogglePinAsync(long noteId, CancellationToken cancellationToken);
    Task<NoteResponse?> UpdateAsync(long noteId, string content, CancellationToken cancellationToken);
    Task DeleteAsync(long noteId, CancellationToken cancellationToken);
}
