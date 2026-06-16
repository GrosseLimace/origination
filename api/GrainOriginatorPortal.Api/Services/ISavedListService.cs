using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Saved customer lists owned by the current user. Create/Update validate the requested
/// trade units against the caller's entitlements.</summary>
public interface ISavedListService
{
    Task<List<SavedListResponse>> GetAllAsync(CancellationToken cancellationToken);
    Task<SavedListResponse> CreateAsync(string name, string query, string? tradeUnits, string? filters,
        string? includedCustomerIds, string? excludedCustomerIds, CancellationToken cancellationToken);
    Task<SavedListResponse?> UpdateAsync(int listId, string name, string query, string? tradeUnits, string? filters,
        string? includedCustomerIds, string? excludedCustomerIds, CancellationToken cancellationToken);
    Task DeleteAsync(int listId, CancellationToken cancellationToken);
}
