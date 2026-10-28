// System namespaces
using System.Security.Claims;

// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// /api/me is how the SPA discovers its roles at all — the SPA's own ID token carries no `roles`
/// claim, so a regression here doesn't fail loudly, it silently hides admin UI from admins (or
/// shows it to everyone). The role read deliberately unions THREE claim sources because
/// Microsoft.Identity.Web surfaces `roles` while MapInboundClaims can remap it to ClaimTypes.Role.
/// The response's userId matters too: the usage dashboard derives the signed-in user's short name
/// from it to default its manager filter.
/// </summary>
public class MeControllerTests
{
    private static MeController CreateSut(ClaimsPrincipal user)
    {
        return new MeController
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = user },
            },
        };
    }

    /// <summary>Builds a principal with an explicit RoleClaimType, mirroring how the JWT
    /// middleware presents an identity.</summary>
    private static ClaimsPrincipal Principal(
        string? upn = "CEgr@scoular.com",
        string roleClaimType = "roles",
        params string[] roles)
    {
        var claims = new List<Claim>();
        if (upn is not null) claims.Add(new Claim("preferred_username", upn));
        claims.AddRange(roles.Select(r => new Claim(roleClaimType, r)));

        return new ClaimsPrincipal(
            new ClaimsIdentity(claims, "test", ClaimTypes.Name, roleClaimType));
    }

    private static MeController.MeResponse Body(ActionResult<MeController.MeResponse> result) =>
        Assert.IsType<MeController.MeResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

    // -------------------------------------------------------------------------
    // Role resolution across the three claim sources.
    // -------------------------------------------------------------------------

    [Fact]
    public void Get_ReadsRolesFromTheIdentitysOwnRoleClaimType()
    {
        var sut = CreateSut(Principal(roleClaimType: "roles", roles: ["Admin"]));

        Assert.Equal(["Admin"], Body(sut.Get()).Roles);
    }

    [Fact]
    public void Get_ReadsRolesWhenRemappedToClaimTypesRole()
    {
        // MapInboundClaims=true rewrites `roles` to the long ClaimTypes.Role URI. Dropping this
        // source would hide every role from the SPA in whichever environment had that config.
        var sut = CreateSut(Principal(roleClaimType: ClaimTypes.Role, roles: ["Admin"]));

        Assert.Equal(["Admin"], Body(sut.Get()).Roles);
    }

    [Fact]
    public void Get_ReadsABareRolesClaim_EvenWhenTheIdentityDeclaresADifferentRoleClaimType()
    {
        // Identity says roles live at ClaimTypes.Role, but the token actually carried `roles`.
        // The union exists precisely for this mismatch.
        var identity = new ClaimsIdentity(
            [new Claim("preferred_username", "CEgr@scoular.com"), new Claim("roles", "Admin")],
            "test", ClaimTypes.Name, ClaimTypes.Role);
        var sut = CreateSut(new ClaimsPrincipal(identity));

        Assert.Equal(["Admin"], Body(sut.Get()).Roles);
    }

    [Fact]
    public void Get_DeduplicatesARolePresentUnderTwoClaimNames()
    {
        // The three sources overlap, so without Distinct() the SPA sees "Admin" twice.
        var identity = new ClaimsIdentity(
            [
                new Claim("preferred_username", "CEgr@scoular.com"),
                new Claim("roles", "Admin"),
                new Claim(ClaimTypes.Role, "Admin"),
            ],
            "test", ClaimTypes.Name, "roles");
        var sut = CreateSut(new ClaimsPrincipal(identity));

        Assert.Equal(["Admin"], Body(sut.Get()).Roles);
    }

    [Fact]
    public void Get_ReturnsNoRolesForAnOrdinaryUser()
    {
        var sut = CreateSut(Principal());

        Assert.Empty(Body(sut.Get()).Roles);
    }

    [Fact]
    public void Get_ReturnsOnlyTheTokensRoles_NoSyntheticOnes()
    {
        // The former UsageDashboardViewAll role was appended here from a DB list. It is gone: the
        // manager dropdown is offered to every dashboard user, so the SPA must not be told about a
        // role the token never carried.
        var sut = CreateSut(Principal(upn: "CEgr@scoular.com", roles: ["Admin"]));

        Assert.Equal(["Admin"], Body(sut.Get()).Roles);
    }

    // -------------------------------------------------------------------------
    // User id resolution.
    // -------------------------------------------------------------------------

    [Fact]
    public void Get_ReturnsThePreferredUsernameAsUserId()
    {
        var sut = CreateSut(Principal(upn: "CEgr@scoular.com"));

        // The full UPN, not the short name — the SPA displays it and derives the short name itself.
        Assert.Equal("CEgr@scoular.com", Body(sut.Get()).UserId);
    }

    [Fact]
    public void Get_FallsBackToTheUpnClaim()
    {
        var identity = new ClaimsIdentity([new Claim("upn", "CEgr@scoular.com")], "test");
        var sut = CreateSut(new ClaimsPrincipal(identity));

        Assert.Equal("CEgr@scoular.com", Body(sut.Get()).UserId);
    }

    [Fact]
    public void Get_ReturnsAnEmptyUserIdRatherThanThrowingWhenNoIdentityClaimIsPresent()
    {
        var sut = CreateSut(new ClaimsPrincipal(new ClaimsIdentity()));

        var body = Body(sut.Get());
        Assert.Equal(string.Empty, body.UserId);
        Assert.Empty(body.Roles);
    }
}
