using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
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
        // UserId + timestamp are request/business context, so the entity is built here and the
        // repository just persists it.
        await _repository.AddSearchLogAsync(new QuerySearchLog
        {
            UserId = _requestContext.GetCurrentUser(),
            SearchText = searchText,
            MatchedQueryId = matchedQueryId,
            Timestamp = DateTime.UtcNow
        }, cancellationToken);
    }
}
