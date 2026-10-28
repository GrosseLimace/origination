// Project namespaces
using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services.Diagnostics;

/// <summary>
/// App-access spike: reads the transitive member list of the Entra group configured at
/// <c>AppAccess:GroupId</c> / <c>AppAccess:GroupName</c> via Microsoft Graph
/// (diagnostics route <c>app-access-group-members</c>; admin-gated, every environment).
/// </summary>
public interface IAppAccessDiagnosticsService
{
    /// <summary>
    /// Never throws for a Graph outcome — the <see cref="AppAccessGroupMembersResponse.Outcome"/>
    /// field is the verdict: Ok, or a categorized reason (EgressBlocked = NSG outbound rule needed,
    /// PermissionMissing = GroupMember.Read.All grant needed, TokenFailure, NotFound, NotConfigured,
    /// MembersIdOnly = User.ReadBasic.All grant needed).
    /// </summary>
    Task<AppAccessGroupMembersResponse> GetGroupMembersAsync(CancellationToken cancellationToken);
}
