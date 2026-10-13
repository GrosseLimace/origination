// Microsoft namespaces
using GrainOriginatorPortal.Infrastructure.Interfaces;
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
    private static NotesController CreateSut(TradeUnitPreferencesDbContext db, string callerUpn = "CEgr@scoular.com",
        params RecapGroupDto[] visibleGroups)
        => CreateSut(db, callerUpn, visibleGroups, []);

    private static NotesController CreateSut(TradeUnitPreferencesDbContext db, string callerUpn,
        RecapGroupDto[] visibleGroups, TeamsChannelDto[] registeredChannels)
    {
        var groups = new Mock<IDailyRecapGroupService>();
        groups.Setup(g => g.GetAllAsync(It.IsAny<CancellationToken>())).ReturnsAsync(visibleGroups.ToList());

        // The controller resolves the caller through IRequestContextService, which reads
        // IHttpContextAccessor rather than ControllerBase.User. Point a REAL RequestContextService
        // at the same HttpContext so these tests still exercise the actual claim chain instead of
        // mocking the identity resolution they depend on.
        var identity = new ClaimsIdentity([new Claim("preferred_username", callerUpn)], "test");
        var httpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) };
        var accessor = new HttpContextAccessor { HttpContext = httpContext };

        var sut = new NotesController(new Mock<INoteService>().Object, db, groups.Object,
            MentionTestDoubles.TeamsChannelStub(registeredChannels),
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

    // ── App groups: what the picker is allowed to offer ───────────────────────
    // Mentioning something that notifies nobody is the failure this filter exists to prevent. A
    // Teams group notifies its channel, so it qualifies even with no members.

    private static RecapGroupDto AppGroup(int id, string name, bool teamsDelivery, int memberCount) => new()
    {
        Id = id,
        Name = name,
        DeliveryMethod = teamsDelivery ? "teams" : "email",
        TeamsChannelEmail = teamsDelivery ? "abcd1234.scoular.com@amer.teams.ms" : null,
        Members = Enumerable.Range(0, memberCount)
            .Select(i => new RecapGroupMemberDto { Type = "person", Id = $"member{i}", Name = $"Member {i}" })
            .ToList(),
    };

    [Fact]
    public async Task GetMentionCatalog_OffersATeamsGroupThatHasNoMembers()
    {
        using var db = Db(nameof(GetMentionCatalog_OffersATeamsGroupThatHasNoMembers));
        Seed(db, assignments: [("CEgr", "1084")], roster: [("CEgr", true)]);

        var catalog = Body(await CreateSut(db, "CEgr@scoular.com",
            AppGroup(7, "Grain Desk", teamsDelivery: true, memberCount: 0)).GetMentionCatalog());

        var group = Assert.Single(catalog.AppGroups);
        Assert.Equal(7, group.GroupId);
        Assert.True(group.PostsToChannel);
        Assert.Equal(0, group.MemberCount);
    }

    [Fact]
    public async Task GetMentionCatalog_StillOmitsAnEmailGroupThatHasNoMembers()
    {
        using var db = Db(nameof(GetMentionCatalog_StillOmitsAnEmailGroupThatHasNoMembers));
        Seed(db, assignments: [("CEgr", "1084")], roster: [("CEgr", true)]);

        var catalog = Body(await CreateSut(db, "CEgr@scoular.com",
            AppGroup(8, "Empty", teamsDelivery: false, memberCount: 0)).GetMentionCatalog());

        Assert.Empty(catalog.AppGroups);
    }

    [Fact]
    public async Task GetMentionCatalog_MarksEmailGroupsAsNotPostingToAChannel()
    {
        using var db = Db(nameof(GetMentionCatalog_MarksEmailGroupsAsNotPostingToAChannel));
        Seed(db, assignments: [("CEgr", "1084")], roster: [("CEgr", true)]);

        var catalog = Body(await CreateSut(db, "CEgr@scoular.com",
            AppGroup(9, "Corn Belt", teamsDelivery: false, memberCount: 3)).GetMentionCatalog());

        var group = Assert.Single(catalog.AppGroups);
        Assert.False(group.PostsToChannel);
        Assert.Equal(3, group.MemberCount);
    }

    // ── Degraded flag ─────────────────────────────────────────────────────────────────────────────
    // Each source fails open on its own so one database being down cannot empty the others. That is
    // right, but it left the client unable to tell "nobody to offer" from "the lookup failed". The
    // flag is that distinction; the lists themselves are unchanged.

    [Fact]
    public async Task GetMentionCatalog_IsNotDegradedWhenEverySourceAnswers()
    {
        using var db = Db(nameof(GetMentionCatalog_IsNotDegradedWhenEverySourceAnswers));
        Seed(db, assignments: [("CEgr", "1084")], roster: [("CEgr", true)]);

        var catalog = Body(await CreateSut(db).GetMentionCatalog());

        Assert.False(catalog.Degraded);
        Assert.Contains(catalog.People, p => p.UserId == "CEgr");
    }

    [Fact]
    public async Task GetMentionCatalog_FlagsDegradedButKeepsPeopleWhenTheGroupsSourceFails()
    {
        using var db = Db(nameof(GetMentionCatalog_FlagsDegradedButKeepsPeopleWhenTheGroupsSourceFails));
        Seed(db, assignments: [("CEgr", "1084"), ("SFletcher", "1084")], roster: [("CEgr", true), ("SFletcher", true)]);
        var groups = new Mock<IDailyRecapGroupService>();
        groups.Setup(g => g.GetAllAsync(It.IsAny<CancellationToken>())).ThrowsAsync(new InvalidOperationException("Origination DB down"));
        var identity = new ClaimsIdentity([new Claim("preferred_username", "CEgr@scoular.com")], "test");
        var httpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) };
        var sut = new NotesController(new Mock<INoteService>().Object, db, groups.Object,
            MentionTestDoubles.TeamsChannelStub([]), new RequestContextService(new HttpContextAccessor { HttpContext = httpContext }),
            new Mock<ILogger<NotesController>>().Object)
        { ControllerContext = new ControllerContext { HttpContext = httpContext } };

        var catalog = Body(await sut.GetMentionCatalog());

        Assert.True(catalog.Degraded);
        Assert.Empty(catalog.AppGroups);                                   // the failed source is empty…
        Assert.Contains(catalog.People, p => p.UserId == "SFletcher");    // …and the others are not
    }

    [Fact]
    public async Task GetMentionCatalog_FlagsDegradedButKeepsGroupsWhenTheTradeUnitSourceFails()
    {
        // A disposed context throws on first use, which is the closest in-memory stand-in for the
        // TradeUnitPreferences database being unreachable.
        var db = Db(nameof(GetMentionCatalog_FlagsDegradedButKeepsGroupsWhenTheTradeUnitSourceFails));
        db.Dispose();
        var group = new RecapGroupDto { Id = 7, Name = "Corn Belt", DeliveryMethod = "email", Members = [new RecapGroupMemberDto()] };

        var catalog = Body(await CreateSut(db, "CEgr@scoular.com", group).GetMentionCatalog());

        Assert.True(catalog.Degraded);
        Assert.Empty(catalog.People);
        Assert.Contains(catalog.AppGroups, g => g.GroupId == 7);
    }
}
