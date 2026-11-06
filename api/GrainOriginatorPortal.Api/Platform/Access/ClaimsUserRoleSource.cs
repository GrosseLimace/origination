// System namespaces
using System.Security.Claims;

namespace GrainOriginatorPortal.Api.Platform.Access;

/// <summary>
/// Reads the role claims the entitlements app puts in the API's access token (plan §7.1). Who holds which
/// role lives there; this app keeps no user-to-role table.
/// </summary>
/// <remarks>
/// Checks every claim name a role can arrive under, as <c>MeController</c> does: Microsoft.Identity.Web uses
/// <c>roles</c> for v2 tokens, but inbound claim mapping can turn it into <see cref="ClaimTypes.Role"/>.
/// </remarks>
public sealed class ClaimsUserRoleSource : IUserRoleSource
{
    private static readonly IReadOnlySet<string> NoRoles = new HashSet<string>();

    public IReadOnlySet<string> GetRoles(ClaimsPrincipal user)
    {
        if (!user.Identities.Any(i => i.IsAuthenticated))
        {
            return NoRoles;
        }

        var roleClaimType = (user.Identity as ClaimsIdentity)?.RoleClaimType ?? ClaimTypes.Role;
        return user.FindAll(roleClaimType)
            .Concat(user.FindAll("roles"))
            .Concat(user.FindAll(ClaimTypes.Role))
            .Select(c => c.Value.Trim())
            .Where(v => v.Length > 0)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }
}
