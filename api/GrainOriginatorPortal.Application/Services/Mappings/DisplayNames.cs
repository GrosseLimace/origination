namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>
/// Shared helper for substituting a stored UPN (CreatedBy/ModifiedBy) with its Azure AD display
/// name during entity → response mapping. The name map is produced by
/// IDisplayNameLookupRepository.ResolveAsync; values absent from the map fall back to the UPN.
/// </summary>
public static class DisplayNames
{
    public static string Apply(string? upn, IReadOnlyDictionary<string, string> map) =>
        !string.IsNullOrEmpty(upn) && map.TryGetValue(upn, out var dn) ? dn : (upn ?? string.Empty);
}
