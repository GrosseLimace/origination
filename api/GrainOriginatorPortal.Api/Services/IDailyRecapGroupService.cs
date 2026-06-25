using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Daily Recap group operations (Daily Digest). The list returns groups the caller created
/// (IsOwner=true, editable) plus ones they're a member of (IsOwner=false, read-only); create/update/
/// delete/toggle are creator-owned. Membership + ownership are resolved against the caller's
/// entitlements + request context inside the service.</summary>
public interface IDailyRecapGroupService
{
    Task<List<RecapGroupDto>> GetAllAsync(CancellationToken cancellationToken);
    Task<RecapGroupDto> CreateAsync(RecapGroupRequest request, CancellationToken cancellationToken);
    Task<RecapGroupDto?> UpdateAsync(int groupId, RecapGroupRequest request, CancellationToken cancellationToken);
    Task<RecapGroupDto?> SetEnabledAsync(int groupId, bool enabled, CancellationToken cancellationToken);
    Task DeleteAsync(int groupId, CancellationToken cancellationToken);
}
