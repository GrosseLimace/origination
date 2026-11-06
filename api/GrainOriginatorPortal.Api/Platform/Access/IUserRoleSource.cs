// System namespaces
using System.Security.Claims;

namespace GrainOriginatorPortal.Api.Platform.Access;

/// <summary>Where a caller's roles come from. Only <see cref="PermissionService"/> reads it.</summary>
public interface IUserRoleSource
{
    /// <summary>The role values the caller holds, compared without regard to case. Empty for an anonymous caller.</summary>
    IReadOnlySet<string> GetRoles(ClaimsPrincipal user);
}
