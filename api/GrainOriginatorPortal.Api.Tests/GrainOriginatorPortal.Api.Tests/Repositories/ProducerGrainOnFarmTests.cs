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
/// Exercises the grain-on-farm replace-on-upsert + compose-on-read added to
/// <see cref="ProducerDetailsRepository"/>, against an InMemory database.
/// </summary>
public class ProducerGrainOnFarmTests
{
    private static ApplicationDbContext NewContext()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"grainonfarm-{Guid.NewGuid()}")
            .Options);
        // ProducerDetails has a required FK to Customer; seed the producer (id 100) so GetAsync's
        // Include(Customer) has a principal to join.
        db.Customers.Add(new Customer { Id = 100, Name = "Smith Farm", ScoularId = "S1" });
        db.SaveChanges();
        return db;
    }

    private static ProducerDetailsRepository Repo(ApplicationDbContext db) =>
        new(db, NullLogger<ProducerDetailsRepository>.Instance);

    private static GrainOnFarmEntry Entry(string code, decimal? onHand, decimal? target) =>
        new() { CommodityCode = code, BushelsOnHand = onHand, TargetBushels = target };

    private static ProducerDetailsUpsertArgs Args(IReadOnlyList<GrainOnFarmEntry> grain) =>
        new() { CustomerId = 100, ScoularId = "S1", CustomerName = "Smith Farm", GrainOnFarm = grain };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_PersistsGrainRows_AndGetComposesCodes()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Entry("YC", 80_000, 100_000), Entry("YSB", 40_000, 50_000) }),
            "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        Assert.NotNull(pd);
        var corn = Assert.Single(pd!.GrainOnFarm, g => g.CommodityCode == "YC");
        Assert.Equal(80_000, corn.BushelsOnHand);
        Assert.Equal(100_000, corn.TargetBushels);
        Assert.Equal(2, pd.GrainOnFarm.Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_ReplacesPriorGrainSet()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Entry("YC", 80_000, 100_000), Entry("YSB", 40_000, null) }),
            "tuser", CancellationToken.None);
        // Re-save with only YC → the YSB row should be gone.
        await repo.UpsertAsync(Args(new[] { Entry("YC", 90_000, 110_000) }), "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        var only = Assert.Single(pd!.GrainOnFarm);
        Assert.Equal("YC", only.CommodityCode);
        Assert.Equal(90_000, only.BushelsOnHand);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_DropsBlankCodes()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Entry("YC", 10, 20), Entry("  ", 99, 99) }), "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        Assert.Single(pd!.GrainOnFarm);
        Assert.Equal("YC", pd.GrainOnFarm[0].CommodityCode);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_EmptyList_ClearsGrainRows()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Entry("YC", 10, 20) }), "tuser", CancellationToken.None);
        await repo.UpsertAsync(Args(Array.Empty<GrainOnFarmEntry>()), "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        Assert.Empty(pd!.GrainOnFarm);
    }

    // -------------------------------------------------------------------------
    // The reason for keying by code: two codes in the same crop group are separate rows.
    [Fact]
    public async Task Upsert_KeepsTwoCodesFromTheSameGroupAsSeparateRows()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Entry("HRWW", 30_000, 7), Entry("SRWW", 12_000, null) }),
            "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        Assert.Equal(new[] { "HRWW", "SRWW" }, pd!.GrainOnFarm.Select(g => g.CommodityCode).OrderBy(c => c));
    }

    // -------------------------------------------------------------------------
    // Rows saved before codes hold a crop-group name; re-saving the producer must keep them as-is.
    [Fact]
    public async Task Upsert_RoundTripsALegacyGroupRowAlongsideCodes()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Entry("Wheat", 5_000, null), Entry("YC", 10, null) }),
            "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        Assert.Contains(pd!.GrainOnFarm, g => g.CommodityCode == "Wheat" && g.BushelsOnHand == 5_000);
        Assert.Contains(pd.GrainOnFarm, g => g.CommodityCode == "YC");
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_DedupesCodesCaseInsensitively_LastWins()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[] { Entry("yc", 1, null), Entry(" YC ", 2, null) }), "tuser", CancellationToken.None);

        var pd = await repo.GetAsync(100, CancellationToken.None);
        var only = Assert.Single(pd!.GrainOnFarm);
        Assert.Equal("YC", only.CommodityCode);
        Assert.Equal(2, only.BushelsOnHand);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_PersistsBushelsSold_OnBothReadPaths()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[]
        {
            new GrainOnFarmEntry { CommodityCode = "YC", BushelsOnHand = 80_000, BushelsSold = 30_000, TargetBushels = 4.25m, LastBid = 4.1025m },
            Entry("YSB", 40_000, null),
        }), "tuser", CancellationToken.None);

        // Single-producer read (profile) and the batched read (Build-A-List) compose separately.
        var single = await repo.GetAsync(100, CancellationToken.None);
        var batched = Assert.Single(await repo.GetAllAsync(CancellationToken.None));
        foreach (var pd in new[] { single!, batched })
        {
            var corn = Assert.Single(pd.GrainOnFarm, g => g.CommodityCode == "YC");
            Assert.Equal(80_000, corn.BushelsOnHand);
            Assert.Equal(30_000, corn.BushelsSold);
            Assert.Equal(4.1025m, corn.LastBid);
            var beans = Assert.Single(pd.GrainOnFarm, g => g.CommodityCode == "YSB");
            Assert.Null(beans.BushelsSold);
            Assert.Null(beans.LastBid);
        }
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upsert_KeepsNegativeTargetAndLastBid()
    {
        // Basis values are negative; nothing on the write or read path may clamp or drop them.
        using var db = NewContext();
        var repo = Repo(db);

        await repo.UpsertAsync(Args(new[]
        {
            new GrainOnFarmEntry { CommodityCode = "YC", BushelsOnHand = 10_000, TargetBushels = -0.25m, LastBid = -0.3525m },
        }), "tuser", CancellationToken.None);

        var corn = Assert.Single((await repo.GetAsync(100, CancellationToken.None))!.GrainOnFarm);
        Assert.Equal(-0.25m, corn.TargetBushels);
        Assert.Equal(-0.3525m, corn.LastBid);
    }
}
