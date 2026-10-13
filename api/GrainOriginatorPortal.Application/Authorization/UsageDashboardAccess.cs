using System.Security.Claims;

namespace GrainOriginatorPortal.Api.Authorization;

/// <summary>
/// Access rules for the usage dashboard. One question: <see cref="CanView"/> — may you open the
/// dashboard at all? Answered by the Admin app role, which arrives via the "Origination App {Env}
/// Super Users" group. That group is simply how a business user is granted access; managers and
/// IT/admin alike are added there.
/// <para>
/// Everyone who can open the dashboard sees the whole organisation and may narrow it to any
/// manager's team. There is no second "how much do you see" list any more — the former
/// <c>dbo.UsageDashboardViewAllUsers</c> table and its synthetic <c>UsageDashboardViewAll</c> role
/// were retired when the manager dropdown was opened to every dashboard user.
/// </para>
/// Exclusion management is separate again — Admin plus the ExclusionManagers allowlist.
/// </summary>
public static class UsageDashboardAccess
{
    /// <summary>Authorization policy name for the dashboard's read endpoints. Currently equivalent to
    /// "AdminOnly", but kept distinct so the read surface is named separately from exclusion
    /// administration — a convention test in ControllerAuthorizationTests pins that split.</summary>
    public const string PolicyName = "UsageDashboardViewer";

    /// <summary>Whether the caller may open the dashboard at all — Super Users group membership,
    /// surfaced as the Admin app role.</summary>
    public static bool CanView(ClaimsPrincipal user) => HasAdminRole(user);

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
