using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Customer notes. List reads are scoped to the caller's entitled trade units; Create
/// stamps the authoritative trade unit from the customer's membership. Create/Update optionally
/// carry "@" mentions, persisted as a JSON array on the note.</summary>
public interface INoteService
{
    Task<List<NoteResponse>> GetAllAsync(string? tradeUnits, CancellationToken cancellationToken);

    /// <summary>Per-customer last-contact aggregate for list badges — all trade units
    /// (entitlement-filtered), no note bodies. Bounded by customer count.</summary>
    Task<List<NoteLastContactResponse>> GetLastContactAsync(CancellationToken cancellationToken);
    Task<List<NoteResponse>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);
    Task<NoteResponse?> GetByIdAsync(long noteId, CancellationToken cancellationToken);
    Task<NoteResponse> CreateAsync(long customerId, string content, IReadOnlyList<NoteMention>? mentions, CancellationToken cancellationToken);
    Task<NoteResponse?> TogglePinAsync(long noteId, CancellationToken cancellationToken);
    Task<NoteResponse?> UpdateAsync(long noteId, string content, IReadOnlyList<NoteMention>? mentions, CancellationToken cancellationToken);
    Task DeleteAsync(long noteId, CancellationToken cancellationToken);
}
