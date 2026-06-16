namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Resolves user UPNs to Azure AD display names via the UserTradeUnitSnapshot table.
/// Shared by any domain that surfaces CreatedBy/ModifiedBy audit fields (saved lists, notes,
/// planting intentions). Returns a UPN/short-form → display-name map; UPNs not found are absent
/// (callers fall back to the original value).
/// </summary>
public interface IDisplayNameLookupRepository
{
    Task<Dictionary<string, string>> ResolveAsync(IEnumerable<string> userIds, CancellationToken cancellationToken);
}
