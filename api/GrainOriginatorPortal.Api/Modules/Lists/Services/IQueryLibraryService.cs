using GrainOriginatorPortal.Api.Modules.Lists.Models.Responses;


namespace GrainOriginatorPortal.Api.Modules.Lists.Services;

/// <summary>Business logic for the query library (curated NLQ examples) and search-gap logging.</summary>
public interface IQueryLibraryService
{
    /// <summary>All active query-library items, sorted by category then sort order.</summary>
    Task<List<QueryLibraryItemResponse>> GetAllAsync(CancellationToken cancellationToken);

    /// <summary>
    /// The name of each of <paramref name="ids"/> that exists, active or not, for reports that name the prompts people
    /// used. Ids with no query are left out.
    /// </summary>
    Task<Dictionary<int, string>> GetNamesAsync(IReadOnlyCollection<int> ids, CancellationToken cancellationToken);

    /// <summary>Logs a user's query-library search (unmatched searches help identify missing queries).</summary>
    Task LogSearchAsync(string searchText, int? matchedQueryId, CancellationToken cancellationToken);
}
