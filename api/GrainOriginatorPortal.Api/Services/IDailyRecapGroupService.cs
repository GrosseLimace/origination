using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Daily Recap group operations (Daily Digest). Edit rights equal visibility: the list
/// returns groups the caller created plus ones they are a member of, and every one of them is
/// editable (CanEdit=true). Delete stays creator-only (IsOwner). Membership and creator identity are
/// resolved against the caller's entitlements + request context inside the service.</summary>
public interface IDailyRecapGroupService
{
    Task<List<RecapGroupDto>> GetAllAsync(CancellationToken cancellationToken);

    Task<RecapGroupDto> CreateAsync(RecapGroupRequest request, CancellationToken cancellationToken);

    /// <summary>Updates a group the caller may edit; null when it does not exist or is not visible to
    /// them. Members already on the group pass through; only additions are entitlement-checked.</summary>
    Task<RecapGroupDto?> UpdateAsync(int groupId, RecapGroupRequest request, CancellationToken cancellationToken);

    /// <summary>Toggles the daily recap on a group the caller may edit; null when not visible.</summary>
    Task<RecapGroupDto?> SetEnabledAsync(int groupId, bool enabled, CancellationToken cancellationToken);

    /// <summary>Deletes a group. Throws NotFoundException when it does not exist, and
    /// ForbiddenException when the caller is not its creator — delete is creator-only.</summary>
    Task DeleteAsync(int groupId, CancellationToken cancellationToken);
}
