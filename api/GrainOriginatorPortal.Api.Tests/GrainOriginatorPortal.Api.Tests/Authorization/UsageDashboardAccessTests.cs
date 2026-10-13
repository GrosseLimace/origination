// System namespaces
using System.Security.Claims;

// Project namespaces
using GrainOriginatorPortal.Api.Authorization;

namespace GrainOriginatorPortal.Api.Tests.Authorization;

/// <summary>
/// Covers the usage-dashboard access rule: <c>CanView</c> — may you open the dashboard at all? The
/// Admin role, across the claim-name variants the JWT middleware can produce. Granted by the
/// "Origination App {Env} Super Users" group, where managers and IT/admin are both added. There is
/// no config allowlist for this, and no second "how much do you see" list — everyone who can open
/// the dashboard sees the whole organisation and may filter by any manager.
/// </summary>
public class UsageDashboardAccessTests
{
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
    public void NoRoles_IsDenied()
    {
        // Without the Admin role from the Super Users group there is no way in — the former
        // Viewers allowlist and the ViewAll table, which were second doors, are both gone.
        Assert.False(UsageDashboardAccess.CanView(User("tthimesch@scoular.com")));
    }

    [Fact]
    public void EmptyIdentity_IsDenied()
    {
        Assert.False(UsageDashboardAccess.CanView(User()));
    }

    [Fact]
    public void ShortName_IsTheUpnPrefix()
    {
        Assert.Equal("TThimesch", UsageDashboardAccess.GetShortName(User("TThimesch@scoular.com")));
        // Already-short names (no '@') pass through unchanged.
        Assert.Equal("TThimesch", UsageDashboardAccess.GetShortName(User("TThimesch")));
    }

    [Fact]
    public void ShortName_IsEmpty_WhenNoIdentityClaimIsPresent()
    {
        Assert.Equal(string.Empty, UsageDashboardAccess.GetShortName(User()));
    }
}
