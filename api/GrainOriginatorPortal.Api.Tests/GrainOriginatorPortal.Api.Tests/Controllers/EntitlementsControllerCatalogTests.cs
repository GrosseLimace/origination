// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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
        return new EntitlementsController(db, new RequestContextService(accessor), new Mock<ILogger<EntitlementsController>>().Object)
        {
            ControllerContext = new ControllerContext { HttpContext = httpContext },
        };
    }

    private static TradeUnitPreferencesDbContext Db(string name)
        => new TradeUnitPreferencesDbContext(new DbContextOptionsBuilder<TradeUnitPreferencesDbContext>()
            .UseInMemoryDatabase(name).Options);

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
}
