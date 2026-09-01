// System namespaces
using System.Security.Claims;

// Project namespaces
using GrainOriginatorPortal.Api.Authorization;

namespace GrainOriginatorPortal.Api.Tests.Authorization;

/// <summary>
/// Covers the usage-dashboard access rules: Admin role (across the claim-name variants the JWT
/// middleware can produce) OR the UsageDashboard:Viewers short-name allowlist.
/// </summary>
public class UsageDashboardAccessTests
{
    private static readonly string[] Viewers = ["TThimesch", "MPaulson"];

    private static ClaimsPrincipal User(string? upn = null, string? roleClaimType = null, params string[] roles)
    {
        var claims = new List<Claim>();
        if (upn is not null) claims.Add(new Claim("preferred_username", upn));
        claims.AddRange(roles.Select(r => new Claim(roleClaimType ?? "roles", r)));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "test", "name", roleClaimType ?? "roles"));
    }

    [Fact]
    public void AdminRole_GrantsAccess_RegardlessOfAllowlist()
    {
        Assert.True(UsageDashboardAccess.CanView(User("someone@scoular.com", null, "Admin"), Viewers));
        Assert.True(UsageDashboardAccess.CanView(User("someone@scoular.com", null, "Admin"), []));
    }

    [Fact]
    public void AdminRole_IsFound_WhenMappedToClaimTypesRole()
    {
        // MapInboundClaims can remap `roles` → ClaimTypes.Role; the check must survive that.
        var user = User("someone@scoular.com", ClaimTypes.Role, "Admin");
        Assert.True(UsageDashboardAccess.CanView(user, []));
    }

    [Fact]
    public void AllowlistedShortName_GrantsAccess_CaseInsensitively()
    {
        Assert.True(UsageDashboardAccess.CanView(User("tthimesch@scoular.com"), Viewers));
        Assert.True(UsageDashboardAccess.CanView(User("MPAULSON@scoular.com"), Viewers));
    }

    [Fact]
    public void NeitherAdminNorAllowlisted_IsDenied()
    {
        Assert.False(UsageDashboardAccess.CanView(User("jsmith@scoular.com", null, "User"), Viewers));
    }

    [Fact]
    public void EmptyIdentity_IsDenied_NotMatchedAgainstTheList()
    {
        // No usable name claim → short name is empty → must not match anything.
        Assert.False(UsageDashboardAccess.CanView(User(), Viewers));
        Assert.False(UsageDashboardAccess.CanView(User(), [""]));
    }

    [Fact]
    public void ShortName_IsTheUpnPrefix()
    {
        Assert.Equal("TThimesch", UsageDashboardAccess.GetShortName(User("TThimesch@scoular.com")));
        // Already-short names (no '@') pass through unchanged.
        Assert.Equal("TThimesch", UsageDashboardAccess.GetShortName(User("TThimesch")));
    }

    [Fact]
    public void IsAllowlisted_IgnoresTheAdminRole()
    {
        // The synthetic /api/me role is only for allowlisted users; admins don't need it.
        Assert.False(UsageDashboardAccess.IsAllowlisted(User("someone@scoular.com", null, "Admin"), Viewers));
        Assert.True(UsageDashboardAccess.IsAllowlisted(User("tthimesch@scoular.com", null, "Admin"), Viewers));
    }
}
