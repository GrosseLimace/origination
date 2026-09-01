using System.Security.Claims;

namespace GrainOriginatorPortal.Api.Authorization;

/// <summary>
/// Access rules for the usage dashboard's read surface: the Admin app role OR a config allowlist
/// (<c>UsageDashboard:Viewers</c>) of short names. The allowlist exists because Entra role
/// assignment requires portal permissions the team doesn't hold — this is the self-service way to
/// let a handful of non-admins see the dashboard. Exclusion management stays Admin-only.
/// <para>
/// The same check backs the <see cref="PolicyName"/> authorization policy (server enforcement) and
/// the synthetic <see cref="ViewerRole"/> that /api/me appends for allowlisted users (client
/// routing/nav). Keeping both on one method means the menu can never show a page the API would 403.
/// </para>
/// </summary>
public static class UsageDashboardAccess
{
    /// <summary>Authorization policy name for the dashboard's read endpoints.</summary>
    public const string PolicyName = "UsageDashboardViewer";

    /// <summary>Synthetic role /api/me appends for allowlisted users. Not an Entra app role —
    /// it only ever originates from the allowlist check on our own server.</summary>
    public const string ViewerRole = "UsageDashboardViewer";

    public static bool CanView(ClaimsPrincipal user, IReadOnlyCollection<string> viewerAllowlist)
        => HasAdminRole(user) || IsAllowlisted(user, viewerAllowlist);

    public static bool IsAllowlisted(ClaimsPrincipal user, IReadOnlyCollection<string> viewerAllowlist)
    {
        var shortName = GetShortName(user);
        return shortName.Length > 0
            && viewerAllowlist.Contains(shortName, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Admin check across every claim name the role can arrive under — mirrors
    /// MeController: Microsoft.Identity.Web surfaces `roles`, but MapInboundClaims can remap it.</summary>
    public static bool HasAdminRole(ClaimsPrincipal user)
    {
        var roleClaimType = (user.Identity as ClaimsIdentity)?.RoleClaimType ?? ClaimTypes.Role;
        return user.FindAll(roleClaimType)
            .Concat(user.FindAll("roles"))
            .Concat(user.FindAll(ClaimTypes.Role))
            .Any(c => c.Value == "Admin");
    }

    /// <summary>Short name (UPN before the '@') — the same identity key the usage tables use.</summary>
    public static string GetShortName(ClaimsPrincipal user)
    {
        var name = user.FindFirst("preferred_username")?.Value
                   ?? user.FindFirst("upn")?.Value
                   ?? user.Identity?.Name
                   ?? string.Empty;
        var at = name.IndexOf('@');
        return at > 0 ? name[..at] : name;
    }
}
