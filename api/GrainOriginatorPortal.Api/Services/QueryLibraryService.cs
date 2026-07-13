using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class QueryLibraryService : IQueryLibraryService
{
    private readonly IQueryLibraryRepository _repository;
    private readonly IRequestContextService _requestContext;

    public QueryLibraryService(IQueryLibraryRepository repository, IRequestContextService requestContext)
    {
        _repository = repository;
        _requestContext = requestContext;
    }

    /// <inheritdoc />
    public async Task<List<QueryLibraryItemResponse>> GetAllAsync(CancellationToken cancellationToken)
    {
        var items = await _repository.GetActiveAsync(cancellationToken);
        return items.Select(i => i.ToResponse()).ToList();
    }

    /// <inheritdoc />
    public async Task LogSearchAsync(string searchText, int? matchedQueryId, CancellationToken cancellationToken)
    {
        // Redact contact PII (emails, phone numbers, bare digit runs) before persisting: the raw
        // search box is free-text and can contain producer emails/phones, and this log is later
        // surfaced to admins via the usage dashboard's query-search-gaps endpoint. Only sensitive
        // tokens are masked, so search terms stay intact for gap analysis.
        // UserId + timestamp are request/business context, so the entity is built here and the
        // repository just persists it.
        await _repository.AddSearchLogAsync(new QuerySearchLog
        {
            UserId = _requestContext.GetCurrentUser(),
            SearchText = TelemetrySanitizer.Redact(searchText, "library-search") ?? searchText,
            MatchedQueryId = matchedQueryId,
            Timestamp = DateTime.UtcNow
        }, cancellationToken);
    }
}
