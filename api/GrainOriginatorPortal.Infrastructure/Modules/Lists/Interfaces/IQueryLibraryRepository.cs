using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.Lists.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Lists.Interfaces;

/// <summary>Data access for the NLQ query library and its search-gap log.</summary>
public interface IQueryLibraryRepository
{
    /// <summary>Active query-library items, ordered by category, sort order, then name.</summary>
    Task<IReadOnlyList<QueryLibraryItem>> GetActiveAsync(CancellationToken cancellationToken);

    /// <summary>The name of each of <paramref name="ids"/> that exists, active or not.</summary>
    Task<Dictionary<int, string>> GetNamesAsync(IReadOnlyCollection<int> ids, CancellationToken cancellationToken);

    /// <summary>Persists a query-search log entry (built by the caller).</summary>
    Task AddSearchLogAsync(QuerySearchLog log, CancellationToken cancellationToken);
}
