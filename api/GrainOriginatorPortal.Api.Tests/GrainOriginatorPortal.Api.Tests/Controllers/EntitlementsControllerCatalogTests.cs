// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data;
using System.Security.Claims;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// The recap-group editor reads this catalog to list people, trade units and groups. It fails open
/// on an entitlements-database outage so the editor still opens, which is right, but an empty
/// catalog then looked identical to a caller who genuinely has no entitlements. The Degraded flag is
/// how the two are told apart; these pin that it is set only on failure.
/// </summary>
public class EntitlementsControllerCatalogTests
{
    private static EntitlementsController CreateSut(TradeUnitPreferencesDbContext db, string callerUpn = "CEgr@scoular.com")
    {
        var identity = new ClaimsIdentity([new Claim("preferred_username", callerUpn)], "test");
        var httpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) };
        var accessor = new HttpContextAccessor { HttpContext = httpContext };
        return new EntitlementsController(new EntitlementsDirectoryService(db), new RequestContextService(accessor),
            new Mock<ILogger<EntitlementsController>>().Object)
        {
            ControllerContext = new ControllerContext { HttpContext = httpContext },
        };
    }

    private static TradeUnitPreferencesDbContext Db(string name) => EntitlementsTestDb.Create(name);

    private static EntitlementsCatalogResponse Body(ActionResult<EntitlementsCatalogResponse> result)
    {
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        return Assert.IsType<EntitlementsCatalogResponse>(ok.Value);
    }

    [Fact]
    public async Task GetCatalog_IsNotDegradedForACallerWithNoEntitlements()
    {
        // An empty answer for a legitimate reason must not be reported as an outage.
        using var db = Db(nameof(GetCatalog_IsNotDegradedForACallerWithNoEntitlements));

        var catalog = Body(await CreateSut(db).GetCatalog());

        Assert.False(catalog.Degraded);
        Assert.Empty(catalog.People);
        Assert.Empty(catalog.TradeUnits);
        Assert.Empty(catalog.Groups);
    }

    [Fact]
    public async Task GetCatalog_StillAnswers200ButFlagsDegradedWhenTheDirectoryCannotBeRead()
    {
        // A disposed context throws on first use: the closest in-memory stand-in for the
        // TradeUnitPreferences database being unreachable.
        var db = Db(nameof(GetCatalog_StillAnswers200ButFlagsDegradedWhenTheDirectoryCannotBeRead));
        db.Dispose();

        var catalog = Body(await CreateSut(db).GetCatalog());

        Assert.True(catalog.Degraded);
        Assert.Empty(catalog.People);
    }

    // ── The full shape, pinned ────────────────────────────────────────────────
    // Pinned before the directory reads moved out of this controller, so the move is checked
    // against what the recap-group editor actually received.

    [Fact]
    public async Task GetCatalog_ReturnsPeopleTradeUnitsAndGroupsFromTheCallersOverlap()
    {
        using var db = EntitlementsTestDb.Create(nameof(GetCatalog_ReturnsPeopleTradeUnitsAndGroupsFromTheCallersOverlap));
        EntitlementsTestDb.SeedDirectory(db);

        var catalog = Body(await CreateSut(db).GetCatalog());

        Assert.False(catalog.Degraded);
        // Everyone sharing a trade unit with the caller, the caller included, ordered by display name
        // ignoring case. Each person's trade units are cut down to the ones the caller shares.
        // lena is deactivated but still listed: this catalog has never checked the roster
        // (the mention catalog does). Pinned as current behaviour, not endorsed.
        Assert.Equal(
            [
                ("alice", "Alice Adams", "alice@scoular.com", "1084"),
                ("bob", "bob Brown", "bob@scoular.com", "2001"),
                ("CEgr", "Caden Egr", "CEgr@scoular.com", "1084,2001"),
                ("lena", "Lena Left", "lena@scoular.com", "1084"),
            ],
            catalog.People.Select(p => (p.UserId, p.DisplayName, p.Email, string.Join(",", p.TradeUnitCodes))));
        Assert.Equal(
            [("1084", "Kansas"), ("2001", "Nebraska")],
            catalog.TradeUnits.Select(t => (t.Code, t.Description)));
        // A group lists ALL its trade units, including 3003, which the caller is not in directly.
        var group = Assert.Single(catalog.Groups);
        Assert.Equal((7, "North Group", "1084,3003"), (group.GroupId, group.Name, string.Join(",", group.TradeUnitCodes)));
    }

}
