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
        IReadOnlyList<ProducerBinSiteEntry>? sites, IReadOnlyList<GrainOnFarmEntry> grain, long customerId = 100) =>
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
}
