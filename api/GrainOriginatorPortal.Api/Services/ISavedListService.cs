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

    /// <summary>Manager-only: team members belonging to the requested trade units (intersected with the
    /// caller's entitled trade units), de-duped and excluding the caller, for the "assign a list" picker.</summary>
    Task<List<TeamMemberResponse>> GetTeamMembersAsync(string? tradeUnitsCsv, CancellationToken cancellationToken);

    /// <summary>Manager-only: assigns an independent copy of the given list content to each target member
    /// (their short UPN). Targets outside the manager's entitled trade units are dropped. Returns the
    /// created copies. The caller is recorded as <c>CreatedBy</c> for "Assigned by" attribution.</summary>
    Task<List<SavedListResponse>> AssignAsync(IReadOnlyList<string> targetUserIds, string name, string query,
        string? tradeUnits, string? filters, string? includedCustomerIds, string? excludedCustomerIds, CancellationToken cancellationToken);

    Task<SavedListResponse> CreateAsync(string name, string query, string? tradeUnits, string? filters,
        string? includedCustomerIds, string? excludedCustomerIds, CancellationToken cancellationToken);
    Task<SavedListResponse?> UpdateAsync(int listId, string name, string query, string? tradeUnits, string? filters,
        string? includedCustomerIds, string? excludedCustomerIds, CancellationToken cancellationToken);
    Task DeleteAsync(int listId, CancellationToken cancellationToken);
}
