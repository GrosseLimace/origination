// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Direct coverage of <see cref="DashboardRepository"/> against an InMemory database: the three
/// upserts' insert / update / remove branches, the per-(trade unit, year) scoping that stops one
/// batch from tripping the unique index on another scope, the casing normalisation on update, and
/// the trade-unit-scoped, crop-ordered reads.
/// </summary>
/// <remarks>
/// The upserts open an explicit transaction, which the InMemory provider cannot honour; the
/// transaction-ignored warning is suppressed so the upsert logic under it can run. That the writes
/// are atomic on SQL Server is a property of the real provider and is not asserted here.
/// </remarks>
public class DashboardRepositoryTests
{
    private const string Tu = "4056";

    private static ApplicationDbContext NewContext() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"dashboard-{Guid.NewGuid()}")
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options);

    private static DashboardPlantingEstimate Estimate(string crop, decimal? yield, string tu = Tu, int year = 2026) => new()
    {
        TradeUnitKey = tu, Crop = crop, PlantingYear = year, YieldEstimate = yield
    };

    private static DashboardMarketShare Share(string category, decimal? pct, string tu = Tu, int year = 2026) => new()
    {
        TradeUnitKey = tu, CropCategory = category, PlantingYear = year, MarketSharePct = pct
    };

    private static DashboardActualHarvest Harvest(string category, int bushels, string tu = Tu, int year = 2026) => new()
    {
        TradeUnitKey = tu, CropCategory = category, PlantingYear = year, Bushels = bushels
    };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Reads_AreScopedToTradeUnitAndYear_AndOrderedByCrop()
    {
        using var db = NewContext();
        db.DashboardPlantingEstimates.AddRange(Estimate("Wheat", 50), Estimate("Corn", 200), Estimate("Corn", 1, year: 2025), Estimate("Corn", 2, tu: "9999"));
        db.DashboardMarketShares.AddRange(Share("Wheat", 10), Share("Corn", 20), Share("Corn", 1, year: 2025));
        db.DashboardActualHarvests.AddRange(Harvest("Wheat", 1), Harvest("Corn", 2), Harvest("Corn", 3, tu: "9999"));
        await db.SaveChangesAsync();
        var repo = new DashboardRepository(db);

        Assert.Equal(new[] { "Corn", "Wheat" }, (await repo.GetPlantingEstimatesAsync(Tu, 2026, CancellationToken.None)).Select(e => e.Crop));
        Assert.Equal(new[] { "Corn", "Wheat" }, (await repo.GetMarketSharesAsync(Tu, 2026, CancellationToken.None)).Select(e => e.CropCategory));
        Assert.Equal(new[] { "Corn", "Wheat" }, (await repo.GetActualHarvestAsync(Tu, 2026, CancellationToken.None)).Select(e => e.CropCategory));
        Assert.Empty(await repo.GetPlantingEstimatesAsync(Tu, 2030, CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task UpsertPlantingEstimates_InsertsNewRows_WithTheCallerAsCreator()
    {
        using var db = NewContext();
        var repo = new DashboardRepository(db);

        await repo.UpsertPlantingEstimatesAsync([Estimate("Corn", 200), Estimate("Wheat", 50)], "cegr", CancellationToken.None);

        var rows = await db.DashboardPlantingEstimates.OrderBy(e => e.Crop).ToListAsync();
        Assert.Equal(new[] { ("Corn", 200m), ("Wheat", 50m) }, rows.Select(r => (r.Crop, r.YieldEstimate!.Value)));
        Assert.All(rows, r => Assert.Equal(("cegr", (string?)null), (r.CreatedBy, r.ModifiedBy)));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task UpsertPlantingEstimates_UpdatesInPlace_NormalisingCropCasing_AndRemovesOnNullYield()
    {
        using var db = NewContext();
        db.DashboardPlantingEstimates.AddRange(Estimate("irrigated corn", 180), Estimate("Wheat", 50), Estimate("Milo", 90));
        await db.SaveChangesAsync();
        var repo = new DashboardRepository(db);

        await repo.UpsertPlantingEstimatesAsync(
        [
            Estimate("Irrigated Corn", 195),   // same row, different casing → updated, not duplicated
            Estimate("Wheat", null),           // null yield → row removed
            Estimate("Soybeans", null),        // null yield for a row that never existed → nothing happens
        ], "cegr", CancellationToken.None);

        var rows = await db.DashboardPlantingEstimates.OrderBy(e => e.Crop).ToListAsync();
        Assert.Equal(new[] { ("Irrigated Corn", 195m), ("Milo", 90m) }, rows.Select(r => (r.Crop, r.YieldEstimate!.Value)));
        var corn = rows.Single(r => r.Crop == "Irrigated Corn");
        Assert.Equal("cegr", corn.ModifiedBy);
        Assert.NotNull(corn.ModifiedAt);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task UpsertPlantingEstimates_BatchSpanningTwoScopes_ResolvesEachAgainstItsOwnRows()
    {
        using var db = NewContext();
        db.DashboardPlantingEstimates.AddRange(Estimate("Corn", 100, year: 2026), Estimate("Corn", 1, tu: "9999", year: 2026));
        await db.SaveChangesAsync();
        var repo = new DashboardRepository(db);

        await repo.UpsertPlantingEstimatesAsync(
        [
            Estimate("Corn", 110, year: 2026),          // existing in (4056, 2026) → update
            Estimate("Corn", 120, year: 2027),          // (4056, 2027) has no row → insert, not a collision with 2026
            Estimate("Corn", 130, tu: "9999", year: 2026), // existing in the other trade unit → update that one
        ], "cegr", CancellationToken.None);

        var rows = await db.DashboardPlantingEstimates.ToListAsync();
        Assert.Equal(3, rows.Count);
        Assert.Equal(110, rows.Single(r => r.TradeUnitKey == Tu && r.PlantingYear == 2026).YieldEstimate);
        Assert.Equal(120, rows.Single(r => r.TradeUnitKey == Tu && r.PlantingYear == 2027).YieldEstimate);
        Assert.Equal(130, rows.Single(r => r.TradeUnitKey == "9999").YieldEstimate);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Upserts_EmptyBatch_IsANoOp()
    {
        using var db = NewContext();
        var repo = new DashboardRepository(db);

        await repo.UpsertPlantingEstimatesAsync([], "cegr", CancellationToken.None);
        await repo.UpsertMarketSharesAsync([], "cegr", CancellationToken.None);
        await repo.UpsertActualHarvestAsync([], "cegr", CancellationToken.None);

        Assert.Equal(0, await db.DashboardPlantingEstimates.CountAsync());
        Assert.Equal(0, await db.DashboardMarketShares.CountAsync());
        Assert.Equal(0, await db.DashboardActualHarvests.CountAsync());
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task UpsertMarketShares_InsertUpdateAndRemove_FollowTheSameRules()
    {
        using var db = NewContext();
        db.DashboardMarketShares.AddRange(Share("corn", 20), Share("Wheat", 10));
        await db.SaveChangesAsync();
        var repo = new DashboardRepository(db);

        await repo.UpsertMarketSharesAsync([Share("Corn", 25), Share("Wheat", null), Share("Milo", 5)], "cegr", CancellationToken.None);

        var rows = await db.DashboardMarketShares.OrderBy(e => e.CropCategory).ToListAsync();
        Assert.Equal(new[] { ("Corn", 25m), ("Milo", 5m) }, rows.Select(r => (r.CropCategory, r.MarketSharePct!.Value)));
        Assert.Equal("cegr", rows.Single(r => r.CropCategory == "Corn").ModifiedBy);
        Assert.Equal("cegr", rows.Single(r => r.CropCategory == "Milo").CreatedBy);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task UpsertActualHarvest_UpdatesExistingAndInsertsNew_NeverRemoves()
    {
        using var db = NewContext();
        db.DashboardActualHarvests.Add(Harvest("corn", 1000));
        await db.SaveChangesAsync();
        var repo = new DashboardRepository(db);

        await repo.UpsertActualHarvestAsync([Harvest("Corn", 0), Harvest("Wheat", 500)], "cegr", CancellationToken.None);

        var rows = await db.DashboardActualHarvests.OrderBy(e => e.CropCategory).ToListAsync();
        Assert.Equal(new[] { ("Corn", 0), ("Wheat", 500) }, rows.Select(r => (r.CropCategory, r.Bushels)));   // zero bushels is a value, not a delete
        Assert.Equal("cegr", rows[0].ModifiedBy);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ActualHarvest_TradeUnitLookupAndDelete_HandleMissingIds()
    {
        using var db = NewContext();
        db.DashboardActualHarvests.Add(Harvest("Corn", 1));
        await db.SaveChangesAsync();
        var repo = new DashboardRepository(db);
        var id = (await db.DashboardActualHarvests.SingleAsync()).Id;

        Assert.Equal(Tu, await repo.GetActualHarvestTradeUnitKeyAsync(id, CancellationToken.None));
        Assert.Null(await repo.GetActualHarvestTradeUnitKeyAsync(id + 1000, CancellationToken.None));

        await repo.DeleteActualHarvestAsync(id + 1000, CancellationToken.None);   // unknown id → no throw
        Assert.Equal(1, await db.DashboardActualHarvests.CountAsync());
        await repo.DeleteActualHarvestAsync(id, CancellationToken.None);
        Assert.Equal(0, await db.DashboardActualHarvests.CountAsync());
    }
}
