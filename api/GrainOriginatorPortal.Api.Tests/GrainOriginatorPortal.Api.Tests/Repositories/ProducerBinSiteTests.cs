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
/// Exercises the bin-site replace-on-upsert + compose-on-read added to
/// <see cref="ProducerDetailsRepository"/>: full-precision storage, name cleanup, duplicate collapse,
/// the null-BinSites-preserves-rows rule, and the hand-cascade on delete.
/// </summary>
public class ProducerBinSiteTests
{
    private static ApplicationDbContext NewContext()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"producerbinsite-{Guid.NewGuid()}")
            .Options);
        db.Customers.Add(new Customer { Id = 100, Name = "Smith Farm", ScoularId = "S1" });
        db.Customers.Add(new Customer { Id = 200, Name = "Jones Farm", ScoularId = "S2" });
        db.SaveChanges();
        return db;
    }

    private static ProducerDetailsRepository Repo(ApplicationDbContext db) =>
        new(db, NullLogger<ProducerDetailsRepository>.Instance);

    private static ProducerBinSiteEntry Site(decimal lat, decimal lng, string? name = null, decimal? capacity = null) =>
        new() { Name = name, Latitude = lat, Longitude = lng, Capacity = capacity };

    private static ProducerDetailsUpsertArgs Args(IReadOnlyList<ProducerBinSiteEntry>? binSites, long customerId = 100, decimal? binCapacity = null) =>
        new() { CustomerId = customerId, CustomerName = "Smith Farm", BinSites = binSites, BinCapacity = binCapacity };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_PersistsBinSites_InSubmittedOrder()
    {
        using var db = NewContext();
        var repo = Repo(db);

        var saved = await repo.UpsertAsync(Args(new[]
        {
            Site(39.115876m, -95.143955m, "Anderson Site"),
            Site(40.5m, -96.25m),
        }), "tuser", CancellationToken.None);

        Assert.Equal(2, saved.BinSites.Count);
        var pd = await repo.GetAsync(100, CancellationToken.None);
        Assert.Equal("Anderson Site", pd!.BinSites[0].Name);
        Assert.Equal(39.115876m, pd.BinSites[0].Latitude);
        Assert.Equal(-95.143955m, pd.BinSites[0].Longitude);
        Assert.Null(pd.BinSites[1].Name);
        Assert.Equal(1, pd.BinSites[1].SortOrder);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_KeepsAFullGoogleMapsPasteExactly()
    {
        using var db = NewContext();
        var repo = Repo(db);

        // Copied straight from Google Maps — users never round by hand.
        await repo.UpsertAsync(Args(new[] { Site(41.39034548435109m, -95.00754031349179m) }), "tuser", CancellationToken.None);

        var site = Assert.Single((await repo.GetAsync(100, CancellationToken.None))!.BinSites);
        Assert.Equal(41.39034548435109m, site.Latitude);
        Assert.Equal(-95.00754031349179m, site.Longitude);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_RoundsOnlyPastTheColumnsFifteenPlaces()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Site(41.12345678901234567m, -95.1234567890123455m) }), "tuser", CancellationToken.None);

        var site = Assert.Single((await repo.GetAsync(100, CancellationToken.None))!.BinSites);
        Assert.Equal(41.123456789012346m, site.Latitude);
        Assert.Equal(-95.123456789012346m, site.Longitude); // midpoint, away from zero
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_TrimsName_AndStoresBlankAsNull()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[]
        {
            Site(39.1m, -95.1m, "  North Bins  "),
            Site(39.2m, -95.2m, "   "),
        }), "tuser", CancellationToken.None);

        var sites = (await repo.GetAsync(100, CancellationToken.None))!.BinSites;
        Assert.Equal("North Bins", sites[0].Name);
        Assert.Null(sites[1].Name);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_CollapsesOnlyExactDuplicateRows()
    {
        using var db = NewContext();
        var repo = Repo(db);

        // Only the Name is required now, so sharing a point (or having none) is not a duplicate —
        // only a row identical in every field is.
        await repo.UpsertAsync(Args(new[]
        {
            Site(39.115876m, -95.143955m, "First"),
            Site(39.115876m, -95.143955m, "first"),          // same row, different case → collapsed
            Site(39.115876m, -95.143955m, "Same spot, other bin"),
            Site(39.1158761m, -95.1439549m, "Next door"),
        }), "tuser", CancellationToken.None);

        var sites = (await repo.GetAsync(100, CancellationToken.None))!.BinSites;
        Assert.Equal(new[] { "First", "Same spot, other bin", "Next door" }, sites.Select(s => s.Name));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_SitesWithoutCoordinates_AreKeptSeparately()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[]
        {
            new ProducerBinSiteEntry { Name = "Home place" },
            new ProducerBinSiteEntry { Name = "North quarter", Capacity = 20_000m },
        }), "tuser", CancellationToken.None);

        var sites = (await repo.GetAsync(100, CancellationToken.None))!.BinSites;
        Assert.Equal(new[] { "Home place", "North quarter" }, sites.Select(s => s.Name));
        Assert.All(sites, s => Assert.Null(s.Latitude));
        Assert.All(sites, s => Assert.Null(s.Longitude));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_ReplacesPriorSet()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Site(39.1m, -95.1m, "Old A"), Site(39.2m, -95.2m, "Old B") }), "tuser", CancellationToken.None);
        await repo.UpsertAsync(Args(new[] { Site(41m, -97m, "New") }), "tuser", CancellationToken.None);

        var only = Assert.Single((await repo.GetAsync(100, CancellationToken.None))!.BinSites);
        Assert.Equal("New", only.Name);
        Assert.Equal(1, await db.ProducerBinSites.CountAsync());
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_NullBinSites_PreservesExistingRows()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Site(39.1m, -95.1m, "Keep me") }), "tuser", CancellationToken.None);
        // An old-shape client (or the linked-producer re-save) sends no binSites at all.
        var saved = await repo.UpsertAsync(Args(null), "tuser", CancellationToken.None);

        Assert.Equal("Keep me", Assert.Single(saved.BinSites).Name);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_EmptyBinSites_RemovesThemAll()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Site(39.1m, -95.1m) }), "tuser", CancellationToken.None);
        await repo.UpsertAsync(Args([]), "tuser", CancellationToken.None);

        Assert.Empty((await repo.GetAsync(100, CancellationToken.None))!.BinSites);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetAll_ComposesBinSitesPerCustomer()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Site(39.1m, -95.1m, "Smith A"), Site(39.2m, -95.2m, "Smith B") }), "tuser", CancellationToken.None);
        await repo.UpsertAsync(Args(new[] { Site(45m, -100m, "Jones") }, customerId: 200), "tuser", CancellationToken.None);

        var all = await repo.GetAllAsync(CancellationToken.None);
        Assert.Equal(new[] { "Smith A", "Smith B" }, all.Single(p => p.CustomerId == 100).BinSites.Select(b => b.Name));
        Assert.Equal("Jones", Assert.Single(all.Single(p => p.CustomerId == 200).BinSites).Name);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Delete_HandCascadesBinSites()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Site(39.1m, -95.1m), Site(39.2m, -95.2m) }), "tuser", CancellationToken.None);
        await repo.UpsertAsync(Args(new[] { Site(45m, -100m) }, customerId: 200), "tuser", CancellationToken.None);

        Assert.True(await repo.DeleteAsync(100, "tuser", CancellationToken.None));

        // Only the deleted producer's rows go; the other producer's site survives.
        var remaining = Assert.Single(await db.ProducerBinSites.ToListAsync());
        Assert.Equal(200, remaining.CustomerId);
    }

    // ===== Capacity (bushels, per site) =====

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_PersistsSiteCapacity_AndComposesItBack()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Site(39.1m, -95.1m, "North", capacity: 50_000m), Site(39.2m, -95.2m, "South") }),
            "tuser", CancellationToken.None);

        var sites = (await repo.GetAsync(100, CancellationToken.None))!.BinSites;
        Assert.Equal(50_000m, sites[0].Capacity);
        Assert.Null(sites[1].Capacity);
        var all = await repo.GetAllAsync(CancellationToken.None);
        Assert.Equal(50_000m, all.Single().BinSites[0].Capacity);
    }

    // -------------------------------------------------------------------------
    // Site capacities are recorded per site only. Summing them into the producer's Bin Capacity was
    // built and then deferred by the user (2026-10-08), so this pins that they do NOT touch it.
    [Fact]
    public async Task Upsert_SiteCapacities_LeaveBinCapacityAsSent()
    {
        using var db = NewContext();
        var repo = Repo(db);

        var saved = await repo.UpsertAsync(Args(new[]
        {
            Site(39.1m, -95.1m, capacity: 50_000m),
            Site(39.2m, -95.2m, capacity: 25_000m),
        }, binCapacity: 40_000m), "tuser", CancellationToken.None);

        Assert.Equal(40_000m, saved.BinCapacity);
        Assert.Equal(40_000m, (await repo.GetAsync(100, CancellationToken.None))!.BinCapacity);
    }

    // ===== Commodity (per site) =====

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_PersistsCommodity_AndComposesItBack()
    {
        using var db = NewContext();
        var repo = Repo(db);

        var site = Site(39.1m, -95.1m, "North", capacity: 50_000m);
        site.CommodityCode = "  YC ";
        await repo.UpsertAsync(Args(new[] { site }), "tuser", CancellationToken.None);

        var one = Assert.Single((await repo.GetAsync(100, CancellationToken.None))!.BinSites);
        Assert.Equal("YC", one.CommodityCode); // trimmed
        var fromAll = Assert.Single((await repo.GetAllAsync(CancellationToken.None)).Single().BinSites);
        Assert.Equal("YC", fromAll.CommodityCode);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_BlankCommodity_IsStoredAsNull()
    {
        using var db = NewContext();
        var repo = Repo(db);

        var site = Site(39.1m, -95.1m);
        site.CommodityCode = "   ";
        await repo.UpsertAsync(Args(new[] { site }), "tuser", CancellationToken.None);

        Assert.Null(Assert.Single((await repo.GetAsync(100, CancellationToken.None))!.BinSites).CommodityCode);
    }
}
