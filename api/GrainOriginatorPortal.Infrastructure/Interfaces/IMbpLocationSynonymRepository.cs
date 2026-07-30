namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Lookups against dbo.MbpLocationSynonym (the MBPLOCSYN location master). Used to resolve a curated
/// DisplayName (e.g. "Adrian, MO") for a location key.
/// </summary>
public interface IMbpLocationSynonymRepository
{
    /// <summary>
    /// Resolves the curated <c>DisplayName</c> for each bare <c>LocationId</c> (e.g. a trade unit code
    /// like "2115" — NOT the composite "2115-ADRIAN"). Returns a case-insensitive map keyed on the
    /// LocationId; codes with no matching row (or a null/blank DisplayName) are simply absent.
    /// </summary>
    Task<Dictionary<string, string>> GetDisplayNamesByLocationIdsAsync(
        IEnumerable<string> locationIds, CancellationToken cancellationToken);
}
