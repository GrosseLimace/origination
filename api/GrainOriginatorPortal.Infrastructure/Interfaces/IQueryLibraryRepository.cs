using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>Data access for the NLQ query library and its search-gap log.</summary>
public interface IQueryLibraryRepository
{
    /// <summary>Active query-library items, ordered by category, sort order, then name.</summary>
    Task<IReadOnlyList<QueryLibraryItem>> GetActiveAsync(CancellationToken cancellationToken);

    /// <summary>Persists a query-search log entry (built by the caller).</summary>
    Task AddSearchLogAsync(QuerySearchLog log, CancellationToken cancellationToken);
}
