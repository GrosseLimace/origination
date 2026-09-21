// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using System.Security.Claims;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// The "@" picker and the save-time check must agree on who is mentionable, or the dropdown offers a
/// name the save then refuses. They read DIFFERENT objects — the picker reads the trade-unit
/// assignment view, the save reads dbo.Users (H-056) — and a leaver can linger in the view after
/// being deactivated, so the agreement has to be enforced rather than assumed. Found live on Dev:
/// 2 of 142 assignable people were inactive.
/// </summary>
public class NotesControllerMentionCatalogTests
{
    private static NotesController CreateSut(TradeUnitPreferencesDbContext db, string callerUpn = "CEgr@scoular.com")
    {
        var groups = new Mock<IDailyRecapGroupService>();
        groups.Setup(g => g.GetAllAsync(It.IsAny<CancellationToken>())).ReturnsAsync([]);

        // The controller resolves the caller through IRequestContextService, which reads
        // IHttpContextAccessor rather than ControllerBase.User. Point a REAL RequestContextService
        // at the same HttpContext so these tests still exercise the actual claim chain instead of
        // mocking the identity resolution they depend on.
        var identity = new ClaimsIdentity([new Claim("preferred_username", callerUpn)], "test");
        var httpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) };
        var accessor = new HttpContextAccessor { HttpContext = httpContext };

        var sut = new NotesController(new Mock<INoteService>().Object, db, groups.Object,
            new RequestContextService(accessor),
            new Mock<ILogger<NotesController>>().Object);

        sut.ControllerContext = new ControllerContext { HttpContext = httpContext };
        return sut;
    }

    /// <summary>The real context maps both entities keyless and read-only (it never writes), which
    /// the in-memory provider can't seed. This subclass adds keys purely so a test can arrange rows;
    /// the query under test is inherited unchanged.</summary>
    private sealed class SeedableContext(DbContextOptions<TradeUnitPreferencesDbContext> options)
        : TradeUnitPreferencesDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            modelBuilder.Entity<UserTradeUnitPreference>(e =>
            {
                e.ToTable("UserTradeUnitPreferences");
                e.HasKey(x => new { x.UserId, x.TradeUnitCode });
            });
            modelBuilder.Entity<TradeUnitPreferencesUser>(e =>
            {
                e.ToTable("Users");
                e.HasKey(x => x.UserId);
            });
        }
    }

    private static TradeUnitPreferencesDbContext Db(string name)
        => new SeedableContext(new DbContextOptionsBuilder<TradeUnitPreferencesDbContext>()
            .UseInMemoryDatabase(name).Options);

    private static void Seed(TradeUnitPreferencesDbContext db,
        (string UserId, string TradeUnit)[] assignments,
        (string UserId, bool IsActive)[] roster)
    {
        db.UserTradeUnitPreferences.AddRange(assignments.Select(a => new UserTradeUnitPreference
        {
            UserId = a.UserId,
            DisplayName = a.UserId,
            TradeUnitCode = a.TradeUnit,
        }));
        db.Users.AddRange(roster.Select(u => new TradeUnitPreferencesUser
        {
            UserId = u.UserId,
            DisplayName = u.UserId,
            IsActive = u.IsActive,
        }));
        db.SaveChanges();
    }

    private static MentionCatalogResponse Body(ActionResult<MentionCatalogResponse> result)
    {
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        return Assert.IsType<MentionCatalogResponse>(ok.Value);
    }

    [Fact]
    public async Task GetMentionCatalog_OmitsColleaguesWhoAreNoLongerActiveUsers()
    {
        using var db = Db(nameof(GetMentionCatalog_OmitsColleaguesWhoAreNoLongerActiveUsers));
        Seed(db,
            assignments: [("CEgr", "1084"), ("SFletcher", "1084"), ("PLeaver", "1084")],
            roster: [("CEgr", true), ("SFletcher", true), ("PLeaver", false)]);

        var catalog = Body(await CreateSut(db).GetMentionCatalog());

        // The leaver is still assigned to the trade unit, but mentioning them would be refused on
        // save and skipped at send, so the picker must not offer them.
        Assert.DoesNotContain(catalog.People, p => p.UserId == "PLeaver");
        Assert.Contains(catalog.People, p => p.UserId == "SFletcher");
        Assert.Contains(catalog.People, p => p.UserId == "CEgr");   // callers can mention themselves
    }

    [Fact]
    public async Task GetMentionCatalog_OmitsSomeoneMissingFromTheRosterEntirely()
    {
        using var db = Db(nameof(GetMentionCatalog_OmitsSomeoneMissingFromTheRosterEntirely));
        Seed(db,
            assignments: [("CEgr", "1084"), ("Ghost", "1084")],
            roster: [("CEgr", true)]);

        var catalog = Body(await CreateSut(db).GetMentionCatalog());

        Assert.DoesNotContain(catalog.People, p => p.UserId == "Ghost");
    }

    [Fact]
    public async Task GetMentionCatalog_StillScopesPeopleToTheCallersTradeUnits()
    {
        using var db = Db(nameof(GetMentionCatalog_StillScopesPeopleToTheCallersTradeUnits));
        Seed(db,
            assignments: [("CEgr", "1084"), ("SFletcher", "1084"), ("Stranger", "9999")],
            roster: [("CEgr", true), ("SFletcher", true), ("Stranger", true)]);

        var catalog = Body(await CreateSut(db).GetMentionCatalog());

        // The active-user filter must narrow the set, never widen it past the trade-unit overlap.
        Assert.DoesNotContain(catalog.People, p => p.UserId == "Stranger");
        Assert.Equal(2, catalog.People.Count);
    }
}
