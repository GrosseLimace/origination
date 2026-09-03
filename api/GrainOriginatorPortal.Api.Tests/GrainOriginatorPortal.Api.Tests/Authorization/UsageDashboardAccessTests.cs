// System namespaces
using System.Security.Claims;

// Project namespaces
using GrainOriginatorPortal.Api.Authorization;

namespace GrainOriginatorPortal.Api.Tests.Authorization;

/// <summary>
/// Covers the usage-dashboard access rules, which answer two separate questions:
/// <list type="bullet">
/// <item><c>CanView</c> — may you open the dashboard at all? The Admin role, across the claim-name
/// variants the JWT middleware can produce. Granted by the "Origination App {Env} Super Users"
/// group, where managers and IT/admin are both added. There is no config allowlist for this.</item>
/// <item><c>CanViewAll</c> — do you get the whole org and the manager dropdown? The
/// <c>UsageDashboard:ViewAll</c> short-name list, and nothing else.</item>
/// </list>
/// </summary>
public class UsageDashboardAccessTests
{
    private static readonly string[] ViewAll = ["TThimesch", "MPaulson"];

    private static ClaimsPrincipal User(string? upn = null, string? roleClaimType = null, params string[] roles)
    {
        var claims = new List<Claim>();
        if (upn is not null) claims.Add(new Claim("preferred_username", upn));
        claims.AddRange(roles.Select(r => new Claim(roleClaimType ?? "roles", r)));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "test", "name", roleClaimType ?? "roles"));
    }

    [Fact]
    public void AdminRole_GrantsAccess()
    {
        // Super Users membership surfaces as the Admin role, and that alone opens the dashboard.
        Assert.True(UsageDashboardAccess.CanView(User("someone@scoular.com", null, "Admin")));
    }

    [Fact]
    public void AdminRole_IsFound_WhenMappedToClaimTypesRole()
    {
        // MapInboundClaims can remap `roles` → ClaimTypes.Role; the check must survive that.
        var user = User("someone@scoular.com", ClaimTypes.Role, "Admin");
        Assert.True(UsageDashboardAccess.CanView(user));
    }

    [Fact]
    public void NonAdminRole_IsDenied()
    {
        Assert.False(UsageDashboardAccess.CanView(User("jsmith@scoular.com", null, "User")));
    }

    [Fact]
    public void BeingOnViewAll_DoesNotByItselfGrantAccess()
    {
        // ViewAll says how MUCH you see, not that you may open the page. Without the Admin role
        // from the Super Users group there is no way in — the former Viewers allowlist, which was a
        // second door for exactly this case, is gone.
        Assert.False(UsageDashboardAccess.CanView(User("tthimesch@scoular.com")));
        Assert.True(UsageDashboardAccess.CanViewAll(User("tthimesch@scoular.com"), ViewAll));
    }

    [Fact]
    public void CanViewAll_IgnoresTheAdminRole()
    {
        // The load-bearing rule. Holding Admin must NOT confer view-all, or every Super Users
        // member would see the whole org and nobody would ever be scoped to their own reports.
        Assert.False(UsageDashboardAccess.CanViewAll(User("someone@scoular.com", null, "Admin"), ViewAll));
        Assert.True(UsageDashboardAccess.CanViewAll(User("tthimesch@scoular.com", null, "Admin"), ViewAll));
    }

    [Fact]
    public void CanViewAll_MatchesTheShortName_CaseInsensitively()
    {
        Assert.True(UsageDashboardAccess.CanViewAll(User("MPAULSON@scoular.com", null, "Admin"), ViewAll));
    }

    [Fact]
    public void CanViewAll_EmptyList_ScopesEveryone()
    {
        // The default. An unset ViewAll section must scope everyone rather than open up.
        Assert.False(UsageDashboardAccess.CanViewAll(User("tthimesch@scoular.com", null, "Admin"), []));
    }

    [Fact]
    public void EmptyIdentity_IsDenied_NotMatchedAgainstTheList()
    {
        // No usable name claim → short name is empty → must not match anything, including an
        // empty-string entry in the list.
        Assert.False(UsageDashboardAccess.CanView(User()));
        Assert.False(UsageDashboardAccess.CanViewAll(User(), ViewAll));
        Assert.False(UsageDashboardAccess.CanViewAll(User(), [""]));
    }

    [Fact]
    public void ShortName_IsTheUpnPrefix()
    {
        Assert.Equal("TThimesch", UsageDashboardAccess.GetShortName(User("TThimesch@scoular.com")));
        // Already-short names (no '@') pass through unchanged.
        Assert.Equal("TThimesch", UsageDashboardAccess.GetShortName(User("TThimesch")));
    }
}
