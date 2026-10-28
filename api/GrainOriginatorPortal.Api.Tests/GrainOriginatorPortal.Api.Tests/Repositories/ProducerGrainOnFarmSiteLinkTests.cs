// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Grain on Farm rows tied to bin sites (2026-10-09): a row names its site by
/// <see cref="ProducerBinSite.SiteKey"/>, the repository resolves it to the FK on save and composes
/// the key and site name back on read. Sites are updated in place by key, so the link survives
/// saves that re-send the sites and saves that leave them out.
/// </summary>
public class ProducerGrainOnFarmSiteLinkTests
{
    private static readonly Guid North = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Home = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private static ApplicationDbContext NewContext()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"grainsitelink-{Guid.NewGuid()}")
            .Options);
        db.Customers.Add(new Customer { Id = 100, Name = "Smith Farm", ScoularId = "S1" });
        db.Customers.Add(new Customer { Id = 200, Name = "Jones Farm", ScoularId = "S2" });
        db.SaveChanges();
        return db;
    }

    private static ProducerDetailsRepository Repo(ApplicationDbContext db) =>
        new(db, NullLogger<ProducerDetailsRepository>.Instance);

    private static ProducerBinSiteEntry Site(Guid key, string name) => new() { SiteKey = key, Name = name };

    private static GrainOnFarmEntry Grain(string code, Guid? site, decimal onHand = 1000m) =>
        new() { CommodityCode = code, BinSiteKey = site, BushelsOnHand = onHand };

    private static ProducerDetailsUpsertArgs Args(
        IReadOnlyList<ProducerBinSiteEntry>? sites, IReadOnlyList<GrainOnFarmEntry>? grain, long customerId = 100) =>
        new() { CustomerId = customerId, CustomerName = "Smith Farm", BinSites = sites, GrainOnFarm = grain };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_LinksGrainToANewSite_AndComposesKeyAndNameBack()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args([Site(North, "North Bins")], [Grain("YC", North, 30_000m)]), "tuser", CancellationToken.None);

        var row = Assert.Single((await repo.GetAsync(100, CancellationToken.None))!.GrainOnFarm);
        Assert.Equal(North, row.BinSiteKey);
        Assert.Equal("North Bins", row.BinSiteName);
        Assert.Equal(30_000m, row.BushelsOnHand);
        var stored = Assert.Single(db.ProducerGrainOnFarm.AsNoTracking());
        Assert.Equal(Assert.Single(db.ProducerBinSites.AsNoTracking()).Id, stored.BinSiteId);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_SameCommodityAtTwoSites_IsTwoRows()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(
            [Site(North, "North Bins"), Site(Home, "Home Place")],
            [Grain("YC", North, 30_000m), Grain("YC", Home, 5_000m)]), "tuser", CancellationToken.None);

        var rows = (await repo.GetAsync(100, CancellationToken.None))!.GrainOnFarm;
        Assert.Equal(2, rows.Count);
        // Display order follows the sites.
        Assert.Equal(["North Bins", "Home Place"], rows.Select(r => r.BinSiteName));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_SameCommodityTwiceAtOneSite_LastWins()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args([Site(North, "North Bins")], [Grain("YC", North, 1m), Grain("yc", North, 2m)]),
            "tuser", CancellationToken.None);

        Assert.Equal(2m, Assert.Single((await repo.GetAsync(100, CancellationToken.None))!.GrainOnFarm).BushelsOnHand);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_ResavingTheSites_KeepsTheirIds_AndTheLink()
    {
        using var db = NewContext();
        var repo = Repo(db);
        await repo.UpsertAsync(Args([Site(North, "North Bins")], [Grain("YC", North)]), "tuser", CancellationToken.None);
        var idBefore = db.ProducerBinSites.AsNoTracking().Single().Id;

        // Renamed — same key, so the same row, updated in place.
        await repo.UpsertAsync(Args([Site(North, "North Quarter")], [Grain("YC", North)]), "tuser", CancellationToken.None);

        Assert.Equal(idBefore, db.ProducerBinSites.AsNoTracking().Single().Id);
        Assert.Equal("North Quarter", Assert.Single((await repo.GetAsync(100, CancellationToken.None))!.GrainOnFarm).BinSiteName);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_NullSites_KeepsGrainLinkedToTheExistingSites()
    {
        using var db = NewContext();
        var repo = Repo(db);
        await repo.UpsertAsync(Args([Site(North, "North Bins")], [Grain("YC", North)]), "tuser", CancellationToken.None);

        // A save that isn't editing sites (a linked-producer re-save) echoes the grain rows back.
        await repo.UpsertAsync(Args(null, [Grain("YC", North, 9m)]), "tuser", CancellationToken.None);

        var pd = (await repo.GetAsync(100, CancellationToken.None))!;
        Assert.Single(pd.BinSites);
        var row = Assert.Single(pd.GrainOnFarm);
        Assert.Equal(North, row.BinSiteKey);
        Assert.Equal(9m, row.BushelsOnHand);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_RemovingASite_RemovesItsGrainRows()
    {
        using var db = NewContext();
        var repo = Repo(db);
        await repo.UpsertAsync(Args(
            [Site(North, "North Bins"), Site(Home, "Home Place")],
            [Grain("YC", North), Grain("SB", Home)]), "tuser", CancellationToken.None);

        // The dialog drops a removed site's grain along with it.
        await repo.UpsertAsync(Args([Site(Home, "Home Place")], [Grain("SB", Home)]), "tuser", CancellationToken.None);

        var pd = (await repo.GetAsync(100, CancellationToken.None))!;
        Assert.Equal("Home Place", Assert.Single(pd.BinSites).Name);
        Assert.Equal("SB", Assert.Single(pd.GrainOnFarm).CommodityCode);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_KeyMatchingNoSite_SavesTheRowWithoutASite()
    {
        using var db = NewContext();
        var repo = Repo(db);

        // A stale tab: its site was deleted elsewhere. The bushels are kept, just not tied to a site.
        await repo.UpsertAsync(Args([], [Grain("YC", North, 7m)]), "tuser", CancellationToken.None);

        var row = Assert.Single((await repo.GetAsync(100, CancellationToken.None))!.GrainOnFarm);
        Assert.Null(row.BinSiteKey);
        Assert.Null(row.BinSiteName);
        Assert.Equal(7m, row.BushelsOnHand);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_RowsWithoutASite_StillSave_AndSortLast()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args([Site(North, "North Bins")], [Grain("SB", null), Grain("YC", North)]),
            "tuser", CancellationToken.None);

        var rows = (await repo.GetAsync(100, CancellationToken.None))!.GrainOnFarm;
        Assert.Equal(["YC", "SB"], rows.Select(r => r.CommodityCode));
        Assert.Null(rows[1].BinSiteKey);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_KeyOwnedByAnotherProducer_GetsAFreshKey()
    {
        using var db = NewContext();
        var repo = Repo(db);
        await repo.UpsertAsync(Args([Site(North, "Jones North")], [], customerId: 200), "tuser", CancellationToken.None);

        await repo.UpsertAsync(Args([Site(North, "Smith North")], [Grain("YC", North)]), "tuser", CancellationToken.None);

        var smith = (await repo.GetAsync(100, CancellationToken.None))!;
        var site = Assert.Single(smith.BinSites);
        Assert.NotEqual(North, site.SiteKey);
        // Jones's site is untouched.
        Assert.Equal(North, Assert.Single((await repo.GetAsync(200, CancellationToken.None))!.BinSites).SiteKey);
        // The grain row named the key that was taken, so it matches no Smith site and keeps its bushels unlinked.
        Assert.Null(Assert.Single(smith.GrainOnFarm).BinSiteKey);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_CollapsedDuplicateSite_MovesItsGrainToTheKeptSite()
    {
        using var db = NewContext();
        var repo = Repo(db);

        // Two identical rows collapse to one site; the second one's grain must not be orphaned.
        await repo.UpsertAsync(Args([Site(North, "North Bins"), Site(Home, "North Bins")], [Grain("SB", Home)]),
            "tuser", CancellationToken.None);

        var pd = (await repo.GetAsync(100, CancellationToken.None))!;
        Assert.Equal(North, Assert.Single(pd.BinSites).SiteKey);
        Assert.Equal(North, Assert.Single(pd.GrainOnFarm).BinSiteKey);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_SiteWithoutAKey_IsGivenOne()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args([new ProducerBinSiteEntry { Name = "Shop" }], []), "tuser", CancellationToken.None);

        Assert.NotEqual(Guid.Empty, Assert.Single((await repo.GetAsync(100, CancellationToken.None))!.BinSites).SiteKey);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetAll_ComposesTheSiteOnEachGrainRow()
    {
        using var db = NewContext();
        var repo = Repo(db);
        await repo.UpsertAsync(Args([Site(North, "North Bins")], [Grain("YC", North)]), "tuser", CancellationToken.None);

        var row = Assert.Single((await repo.GetAllAsync(CancellationToken.None)).Single().GrainOnFarm);
        Assert.Equal(North, row.BinSiteKey);
        Assert.Equal("North Bins", row.BinSiteName);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Delete_RemovesLinkedGrainAndSitesTogether()
    {
        using var db = NewContext();
        var repo = Repo(db);
        await repo.UpsertAsync(Args([Site(North, "North Bins")], [Grain("YC", North)]), "tuser", CancellationToken.None);

        Assert.True(await repo.DeleteAsync(100, "tuser", CancellationToken.None));

        Assert.Empty(db.ProducerGrainOnFarm.AsNoTracking());
        Assert.Empty(db.ProducerBinSites.AsNoTracking());
    }

    // ===== BinSitesModifiedAt (Build a List orders by it) =====

    private static readonly DateTime LongAgo = new(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    private static async Task<DateTime?> StampAsync(ApplicationDbContext db) =>
        (await db.ProducerDetails.AsNoTracking().SingleAsync(p => p.CustomerId == 100)).BinSitesModifiedAt;

    private static async Task BackdateAsync(ApplicationDbContext db)
    {
        var pd = await db.ProducerDetails.SingleAsync(p => p.CustomerId == 100);
        pd.BinSitesModifiedAt = LongAgo;
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
    }

    // -------------------------------------------------------------------------
    // Null grain = not provided = preserve (QA, RUNDMAP, 2026-10-12: the home page's automatic commodity
    // save resent a cached, pre-teammate-edit copy and wiped the teammate's grain).
    [Fact]
    public async Task Upsert_NullGrain_PreservesTheRowsAndTheStamp()
    {
        using var db = NewContext();
        var repo = Repo(db);
        await repo.UpsertAsync(Args([Site(North, "North Bins")], [Grain("YC", North, 50_000m), Grain("SB", North)]), "mpaulson", CancellationToken.None);
        await BackdateAsync(db);

        // An acres-style save that carries neither sites nor grain, then one that re-sends the sites only.
        var saved = await repo.UpsertAsync(Args(null, null), "tuser", CancellationToken.None);
        db.ChangeTracker.Clear();
        var saved2 = await repo.UpsertAsync(Args([Site(North, "North Bins")], null), "tuser", CancellationToken.None);

        Assert.Equal(2, saved.GrainOnFarm.Count);
        Assert.Equal(2, saved2.GrainOnFarm.Count);
        Assert.Equal(50_000m, saved2.GrainOnFarm.Single(g => g.CommodityCode == "YC").BushelsOnHand);
        Assert.Equal(2, db.ProducerGrainOnFarm.AsNoTracking().Count());
        Assert.Equal(LongAgo, await StampAsync(db));
    }

    [Fact]
    public async Task Upsert_NullGrain_RemovingASite_DropsOnlyThatSitesRows()
    {
        using var db = NewContext();
        var repo = Repo(db);
        await repo.UpsertAsync(Args([Site(North, "North Bins"), Site(Home, "Home Place")], [Grain("YC", North), Grain("SB", Home)]), "tuser", CancellationToken.None);
        await BackdateAsync(db);

        var saved = await repo.UpsertAsync(Args([Site(North, "North Bins")], null), "tuser", CancellationToken.None);

        var row = Assert.Single(saved.GrainOnFarm);
        Assert.Equal(("YC", North), (row.CommodityCode, row.BinSiteKey));
        Assert.Single(db.ProducerBinSites.AsNoTracking());
        Assert.True(await StampAsync(db) > LongAgo);
    }

    [Fact]
    public async Task Upsert_EmptyGrain_StillRemovesEveryRow()
    {
        using var db = NewContext();
        var repo = Repo(db);
        await repo.UpsertAsync(Args([Site(North, "North Bins")], [Grain("YC", North)]), "tuser", CancellationToken.None);

        var saved = await repo.UpsertAsync(Args([Site(North, "North Bins")], []), "tuser", CancellationToken.None);

        Assert.Empty(saved.GrainOnFarm);
        Assert.Empty(db.ProducerGrainOnFarm.AsNoTracking());
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_FirstSitesAndGrain_StampBinSitesModifiedAt()
    {
        using var db = NewContext();
        var repo = Repo(db);

        var saved = await repo.UpsertAsync(Args([Site(North, "North Bins")], [Grain("YC", North)]), "tuser", CancellationToken.None);

        Assert.NotNull(saved.BinSitesModifiedAt);
        Assert.NotNull(await StampAsync(db));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_SameSitesAndGrain_LeavesTheStampAlone()
    {
        using var db = NewContext();
        var repo = Repo(db);
        await repo.UpsertAsync(Args([Site(North, "North Bins")], [Grain("YC", North, 30_000m)]), "tuser", CancellationToken.None);
        await BackdateAsync(db);

        // Same values (30000 vs 30000.00 read back), and a save that leaves sites out (null) entirely.
        await repo.UpsertAsync(Args([Site(North, "North Bins")], [Grain("YC", North, 30_000.00m)]), "tuser", CancellationToken.None);
        db.ChangeTracker.Clear();
        await repo.UpsertAsync(Args(null, [Grain("YC", North, 30_000m)]), "tuser", CancellationToken.None);

        Assert.Equal(LongAgo, await StampAsync(db));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_SameValueBeyondColumnScale_LeavesTheStampAlone()
    {
        // decimal(18,2) stores 30000.555 as 30000.56; the comparison must round the same way or every later
        // save (an acres edit, say) would see 30000.56 != 30000.555 and move the stamp.
        using var db = NewContext();
        var repo = Repo(db);
        await repo.UpsertAsync(Args([Site(North, "North Bins")], [Grain("YC", North, 30_000.555m)]), "tuser", CancellationToken.None);
        await BackdateAsync(db);

        await repo.UpsertAsync(Args([Site(North, "North Bins")], [Grain("YC", North, 30_000.56m)]), "tuser", CancellationToken.None);

        Assert.Equal(LongAgo, await StampAsync(db));
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("bushels")]
    [InlineData("rename")]
    [InlineData("add site")]
    [InlineData("remove grain")]
    public async Task Upsert_AChangeToSitesOrGrain_MovesTheStamp(string change)
    {
        using var db = NewContext();
        var repo = Repo(db);
        await repo.UpsertAsync(Args([Site(North, "North Bins")], [Grain("YC", North, 30_000m)]), "tuser", CancellationToken.None);
        await BackdateAsync(db);

        var args = change switch
        {
            "bushels" => Args([Site(North, "North Bins")], [Grain("YC", North, 31_000m)]),
            "rename" => Args([Site(North, "North Quarter")], [Grain("YC", North, 30_000m)]),
            "add site" => Args([Site(North, "North Bins"), Site(Home, "Home Place")], [Grain("YC", North, 30_000m)]),
            _ => Args([Site(North, "North Bins")], []),
        };
        await repo.UpsertAsync(args, "tuser", CancellationToken.None);

        Assert.True(await StampAsync(db) > LongAgo);
    }
}
