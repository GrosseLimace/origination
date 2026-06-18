using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Saved customer lists owned by the current user. Create/Update validate the requested
/// trade units against the caller's entitlements.</summary>
public interface ISavedListService
{
    Task<List<SavedListResponse>> GetAllAsync(CancellationToken cancellationToken);

    /// <summary>Manager-only: all saved lists created by other users whose trade units overlap the
    /// requested CSV (intersected with the caller's entitled trade units), with creator display names.</summary>
    Task<List<SavedListResponse>> GetTeamListsAsync(string? tradeUnitsCsv, CancellationToken cancellationToken);

    Task<SavedListResponse> CreateAsync(string name, string query, string? tradeUnits, string? filters,
        string? includedCustomerIds, string? excludedCustomerIds, CancellationToken cancellationToken);
    Task<SavedListResponse?> UpdateAsync(int listId, string name, string query, string? tradeUnits, string? filters,
        string? includedCustomerIds, string? excludedCustomerIds, CancellationToken cancellationToken);
    Task DeleteAsync(int listId, CancellationToken cancellationToken);
}
