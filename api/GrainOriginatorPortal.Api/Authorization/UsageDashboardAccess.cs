using System.Security.Claims;

namespace GrainOriginatorPortal.Api.Authorization;

/// <summary>
/// Access rules for the usage dashboard. Two independent questions, deliberately kept apart:
/// <list type="bullet">
/// <item><see cref="CanView"/> — may you open the dashboard at all? Answered by the Admin app role,
/// which arrives via the "Origination App {Env} Super Users" group. That group is simply how a
/// business user is granted access; managers and IT/admin alike are added there.</item>
/// <item><see cref="CanViewAll"/> — how much of it do you see? Answered by the
/// <c>UsageDashboard:ViewAll</c> config list. Those few get the manager dropdown and the whole
/// organisation; everyone else is scoped to themselves plus their own reports.</item>
/// </list>
/// Exclusion management is separate again — Admin plus the ExclusionManagers allowlist.
/// </summary>
public static class UsageDashboardAccess
{
    /// <summary>Authorization policy name for the dashboard's read endpoints. Currently equivalent to
    /// "AdminOnly", but kept distinct so the read surface is named separately from exclusion
    /// administration — a convention test in ControllerAuthorizationTests pins that split.</summary>
    public const string PolicyName = "UsageDashboardViewer";

    /// <summary>Synthetic role /api/me appends for the <c>UsageDashboard:ViewAll</c> list — the
    /// people who may read the WHOLE org and pick any manager. The client uses it to show or hide
    /// the manager dropdown; the server does not trust it back, it re-derives from config.</summary>
    public const string ViewAllRole = "UsageDashboardViewAll";

    /// <summary>Whether the caller may open the dashboard at all — Super Users group membership,
    /// surfaced as the Admin app role.</summary>
    public static bool CanView(ClaimsPrincipal user) => HasAdminRole(user);

    /// <summary>Whether the caller may read the entire organisation and choose an arbitrary manager.
    /// <para>
    /// Deliberately does NOT include <see cref="HasAdminRole"/>, and do not "simplify" it to do so.
    /// The Admin role only tells you someone may OPEN the dashboard — the question
    /// <see cref="CanView"/> already answers — because the Super Users group is how managers and
    /// IT/admin are both granted access. It says nothing about how much of the org they should see,
    /// which is a separate decision and needs its own list.
    /// </para><para>
    /// It also could not work: every name on the ViewAll list already holds Admin in QA and PROD
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
