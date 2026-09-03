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

    /// <summary>Synthetic role /api/me appends for the <c>UsageDashboard:ViewAll</c> list — the
    /// people who may read the WHOLE org and pick any manager. The client uses it to show or hide
    /// the manager dropdown; the server does not trust it back, it re-derives from config.</summary>
    public const string ViewAllRole = "UsageDashboardViewAll";

    public static bool CanView(ClaimsPrincipal user, IReadOnlyCollection<string> viewerAllowlist)
        => HasAdminRole(user) || IsAllowlisted(user, viewerAllowlist);

    /// <summary>Whether the caller may read the entire organisation and choose an arbitrary manager.
    /// <para>
    /// Deliberately does NOT include <see cref="HasAdminRole"/>, and do not "simplify" it to do so.
    /// The Admin role arrives via the "Origination App {Env} Super Users" group, which is simply how
    /// a business user is granted dashboard access — membership means "may open the usage dashboard",
    /// not that the account is a developer's or IT's, and not that its owner should see the whole
    /// company. That question is answered by <see cref="CanView"/>; this one is about how much of it
    /// they get, which is a different decision and needs its own list.
    /// </para><para>
    /// It also could not work: every name on the Viewers list already holds Admin in QA and PROD
    /// through those groups, so an Admin-implies-view-all rule would leave nobody scoped in the only
    /// environments that matter, and the self-scoping in UsageDashboardService would be dead code
    /// that still passed its tests.
    /// </para></summary>
    public static bool CanViewAll(ClaimsPrincipal user, IReadOnlyCollection<string> viewAllList)
    {
        var shortName = GetShortName(user);
        return shortName.Length > 0
            && viewAllList.Contains(shortName, StringComparer.OrdinalIgnoreCase);
    }

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
