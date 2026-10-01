// System namespaces
using System.Security.Claims;

// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Authorization;
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// /api/me is how the SPA discovers its roles at all — the SPA's own ID token carries no `roles`
/// claim, so a regression here doesn't fail loudly, it silently hides admin UI from admins (or
/// shows it to everyone). The role read deliberately unions THREE claim sources because
/// Microsoft.Identity.Web surfaces `roles` while MapInboundClaims can remap it to ClaimTypes.Role,
/// and it appends one synthetic role on top. None of that branching was covered.
/// </summary>
public class MeControllerTests
{
    private static MeController CreateSut(ClaimsPrincipal user, params string[] viewAllList)
        => CreateSut(user, new ConfigurationBuilder().Build(), [], viewAllList);

    private static MeController CreateSut(ClaimsPrincipal user, IConfiguration configuration, string[] tableTesters, params string[] viewAllList)
    {
        var viewAll = new Mock<IUsageDashboardViewAllProvider>();
        viewAll.Setup(v => v.GetAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HashSet<string>(viewAllList, StringComparer.OrdinalIgnoreCase));
        var testers = new Mock<ICtrmSourceToggleUserProvider>();
        testers.Setup(t => t.GetAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HashSet<string>(tableTesters, StringComparer.OrdinalIgnoreCase));

        return new MeController(viewAll.Object, testers.Object, configuration)
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
    // The data-source toggle flags (2026-10-01): presentational, derived from the same allow-list the
    // switches enforce, so the SPA shows the control to exactly the people whose choice would take effect.
    // -------------------------------------------------------------------------

    private static IConfiguration CtrmConfig(string source, string toggleUsers) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:Source"] = source, ["Ctrm:SourceToggleUsers"] = toggleUsers,
        }).Build();

    [Fact]
    public async Task AConfigListedUser_IsToldTheyCanChoose_AndWhatTheDefaultIs()
    {
        var sut = CreateSut(Principal(upn: "CEgr@scoular.com"), CtrmConfig("ods", "a@scoular.com, cegr@scoular.com"), []);

        var body = Body(await sut.Get(CancellationToken.None));

        Assert.True(body.CanChooseDataSource);
        Assert.Equal("ods", body.DefaultDataSource);
    }

    [Fact]
    public async Task ATableListedUser_IsToldTheyCanChoose()
    {
        var sut = CreateSut(Principal(upn: "CEgr@scoular.com"), CtrmConfig("ods", ""), ["cegr@scoular.com"]);

        Assert.True(Body(await sut.Get(CancellationToken.None)).CanChooseDataSource);
    }

    [Fact]
    public async Task AnUnlistedUser_CannotChoose()
    {
        var sut = CreateSut(Principal(upn: "someone@scoular.com"), CtrmConfig("ctrm", "CEgr@scoular.com"), ["other@scoular.com"]);

        var body = Body(await sut.Get(CancellationToken.None));

        Assert.False(body.CanChooseDataSource);
        Assert.Equal("ctrm", body.DefaultDataSource);
    }

    [Fact]
    public async Task WithNoListConfigured_NobodyCanChoose_AndTheDefaultIsOds()
    {
        var body = Body(await CreateSut(Principal(upn: "CEgr@scoular.com")).Get(CancellationToken.None));

        Assert.False(body.CanChooseDataSource);
        Assert.Equal("ods", body.DefaultDataSource);
    }

    // -------------------------------------------------------------------------
    // Role resolution across the three claim sources.
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Get_ReadsRolesFromTheIdentitysOwnRoleClaimType()
    {
        var sut = CreateSut(Principal(roleClaimType: "roles", roles: ["Admin"]));

        Assert.Equal(["Admin"], Body(await sut.Get(CancellationToken.None)).Roles);
    }

    [Fact]
    public async Task Get_ReadsRolesWhenRemappedToClaimTypesRole()
    {
        // MapInboundClaims=true rewrites `roles` to the long ClaimTypes.Role URI. Dropping this
        // source would hide every role from the SPA in whichever environment had that config.
        var sut = CreateSut(Principal(roleClaimType: ClaimTypes.Role, roles: ["Admin"]));

        Assert.Equal(["Admin"], Body(await sut.Get(CancellationToken.None)).Roles);
    }

    [Fact]
    public async Task Get_ReadsABareRolesClaim_EvenWhenTheIdentityDeclaresADifferentRoleClaimType()
    {
        // Identity says roles live at ClaimTypes.Role, but the token actually carried `roles`.
        // The union exists precisely for this mismatch.
        var identity = new ClaimsIdentity(
            [new Claim("preferred_username", "CEgr@scoular.com"), new Claim("roles", "Admin")],
            "test", ClaimTypes.Name, ClaimTypes.Role);
        var sut = CreateSut(new ClaimsPrincipal(identity));

        Assert.Equal(["Admin"], Body(await sut.Get(CancellationToken.None)).Roles);
    }

    [Fact]
    public async Task Get_DeduplicatesARolePresentUnderTwoClaimNames()
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

        Assert.Equal(["Admin"], Body(await sut.Get(CancellationToken.None)).Roles);
    }

    [Fact]
    public async Task Get_ReturnsNoRolesForAnOrdinaryUser()
    {
        var sut = CreateSut(Principal());

        Assert.Empty(Body(await sut.Get(CancellationToken.None)).Roles);
    }

    // -------------------------------------------------------------------------
    // The synthetic ViewAll role.
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Get_AppendsTheViewAllRoleForSomeoneOnTheViewAllList()
    {
        var sut = CreateSut(Principal(upn: "CEgr@scoular.com", roles: ["Admin"]), "CEgr");

        var roles = Body(await sut.Get(CancellationToken.None)).Roles;
        Assert.Contains("Admin", roles);
        Assert.Contains(UsageDashboardAccess.ViewAllRole, roles);
    }

    [Fact]
    public async Task Get_MatchesTheViewAllListCaseInsensitively()
    {
        // The list is hand-maintained SQL; casing must not decide who sees the manager dropdown.
        var sut = CreateSut(Principal(upn: "CEgr@scoular.com"), "cegr");

        Assert.Contains(UsageDashboardAccess.ViewAllRole, Body(await sut.Get(CancellationToken.None)).Roles);
    }

    [Fact]
    public async Task Get_DoesNotAppendViewAllForSomeoneOffTheList()
    {
        var sut = CreateSut(Principal(upn: "CEgr@scoular.com", roles: ["Admin"]), "SomeoneElse");

        // Admin alone must NOT imply view-all — every ViewAll name already holds Admin in QA and
        // PROD, so an Admin-implies-view-all rule would leave nobody scoped there.
        Assert.DoesNotContain(UsageDashboardAccess.ViewAllRole, Body(await sut.Get(CancellationToken.None)).Roles);
    }

    [Fact]
    public async Task Get_DoesNotAppendViewAllTwiceWhenTheTokenAlreadyCarriesIt()
    {
        var sut = CreateSut(
            Principal(upn: "CEgr@scoular.com", roles: [UsageDashboardAccess.ViewAllRole]), "CEgr");

        var roles = Body(await sut.Get(CancellationToken.None)).Roles;
        Assert.Single(roles.Where(r => r == UsageDashboardAccess.ViewAllRole));
    }

    [Fact]
    public async Task Get_DoesNotAppendViewAllWhenTheListIsEmpty()
    {
        // Default posture: an empty table means nobody is unscoped, rather than everybody.
        var sut = CreateSut(Principal(upn: "CEgr@scoular.com", roles: ["Admin"]));

        Assert.DoesNotContain(UsageDashboardAccess.ViewAllRole, Body(await sut.Get(CancellationToken.None)).Roles);
    }

    // -------------------------------------------------------------------------
    // User id resolution.
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Get_ReturnsThePreferredUsernameAsUserId()
    {
        var sut = CreateSut(Principal(upn: "CEgr@scoular.com"));

        // The full UPN, not the short name — the SPA displays it.
        Assert.Equal("CEgr@scoular.com", Body(await sut.Get(CancellationToken.None)).UserId);
    }

    [Fact]
    public async Task Get_FallsBackToTheUpnClaim()
    {
        var identity = new ClaimsIdentity([new Claim("upn", "CEgr@scoular.com")], "test");
        var sut = CreateSut(new ClaimsPrincipal(identity));

        Assert.Equal("CEgr@scoular.com", Body(await sut.Get(CancellationToken.None)).UserId);
    }

    [Fact]
    public async Task Get_ReturnsAnEmptyUserIdRatherThanThrowingWhenNoIdentityClaimIsPresent()
    {
        var sut = CreateSut(new ClaimsPrincipal(new ClaimsIdentity()));

        var body = Body(await sut.Get(CancellationToken.None));
        Assert.Equal(string.Empty, body.UserId);
        Assert.Empty(body.Roles);
    }
}
