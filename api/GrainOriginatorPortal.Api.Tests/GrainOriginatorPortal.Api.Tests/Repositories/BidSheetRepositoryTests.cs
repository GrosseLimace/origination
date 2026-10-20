// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Direct coverage of <see cref="BidSheetRepository"/> against an InMemory database: trade-unit
/// scoping of locations and elevators, the bulk bid upsert's location matching (elevator code first,
/// then name), its insert / update / clear-to-delete branches, the distinct-and-ordered filter
/// lookups, and the two per-user preference upserts.
/// </summary>
/// <remarks>
/// Deliberately NOT tested here: the unique-constraint race recovery
/// (<c>ReconcileDuplicateBidInsertsAsync</c> / <c>ReconcileDuplicateLocationInsertsAsync</c>). Both
/// are entered only from a <c>DbUpdateException</c> wrapping a SQL Server 2601/2627, which the
/// InMemory provider never raises. Case-insensitive name matching on the SQL side is likewise left
/// to the real-SQL harness; only the .NET-side dictionary comparers are pinned below.
/// </remarks>
public class BidSheetRepositoryTests
{
    private const string Tu = "4056";
    private const string User = "cegr";

    private static ApplicationDbContext NewContext() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"bidsheet-{Guid.NewGuid()}")
            .Options);

    private static BidSheetRepository Repo(ApplicationDbContext db) =>
        new(db, NullLogger<BidSheetRepository>.Instance);

    private static BidSheetLocation Location(int id, string name, string tradeUnit = Tu, string? elevatorCode = null) => new()
    {
        Id = id, Name = name, TradeUnitCode = tradeUnit, ElevatorCode = elevatorCode, CreatedBy = "seed", CreatedAt = new DateTime(2026, 1, 1)
    };

    private static BidSheetLocationBid Bid(int locationId, string commodity, int cropYear, int month, string bid) => new()
    {
        LocationId = locationId, CommodityCode = commodity, CropYear = cropYear, Month = month, Bid = bid, CreatedBy = "seed"
    };

    private static BidUpsertInput Input(string? name, string commodity, int cropYear, int month, string bid, string? elevatorCode = null) => new()
    {
        Name = name, ElevatorCode = elevatorCode, CommodityCode = commodity, CropYear = cropYear, Month = month, Bid = bid
    };

    // =========================================================================
    // Reads
    // =========================================================================

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetElevatorsAsync_ActiveOnly_OptionallyScopedToTradeUnit()
    {
        using var db = NewContext();
        db.ElevatorCaches.AddRange(
            new ElevatorCache { ElevatorCode = "A", TradeUnitCode = Tu, IsActive = true },
            new ElevatorCache { ElevatorCode = "B", TradeUnitCode = "9999", IsActive = true },
            new ElevatorCache { ElevatorCode = "C", TradeUnitCode = Tu, IsActive = false });
        await db.SaveChangesAsync();
        var repo = Repo(db);

        var all = await repo.GetElevatorsAsync(null, CancellationToken.None);
        var scoped = await repo.GetElevatorsAsync(Tu, CancellationToken.None);

        Assert.Equal(new[] { "A", "B" }, all.Select(e => e.ElevatorCode).OrderBy(c => c));
        Assert.Equal(new[] { "A" }, scoped.Select(e => e.ElevatorCode));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetLocationsAsync_ScopesToTradeUnit_OrdersByName_AndIncludesBids()
    {
        using var db = NewContext();
        db.BidSheetLocations.AddRange(Location(1, "Zeta"), Location(2, "Alpha"), Location(3, "Other TU", tradeUnit: "9999"));
        db.BidSheetLocationBids.Add(Bid(2, "YC", 2026, 0, "4.10"));
        await db.SaveChangesAsync();
        var repo = Repo(db);

        var scoped = await repo.GetLocationsAsync(Tu, CancellationToken.None);
        var all = await repo.GetAllLocationsAsync(CancellationToken.None);

        Assert.Equal(new[] { "Alpha", "Zeta" }, scoped.Select(l => l.Name));
        Assert.Single(scoped[0].Bids);
        Assert.Equal(new[] { "Alpha", "Other TU", "Zeta" }, all.Select(l => l.Name));
        Assert.Equal(Tu, await repo.GetLocationTradeUnitCodeAsync(1, CancellationToken.None));
        Assert.Null(await repo.GetLocationTradeUnitCodeAsync(99, CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task LocationNameExistsAsync_TrimsTheCandidate_AndIsTradeUnitScoped()
    {
        using var db = NewContext();
        db.BidSheetLocations.Add(Location(1, "Madrid"));
        await db.SaveChangesAsync();
        var repo = Repo(db);

        Assert.True(await repo.LocationNameExistsAsync("  Madrid  ", Tu, CancellationToken.None));
        Assert.False(await repo.LocationNameExistsAsync("Madrid", "9999", CancellationToken.None));
        Assert.False(await repo.LocationNameExistsAsync("Lincoln", Tu, CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task FilterLookups_AreDistinctOrderedAndScopedThroughTheLocation()
    {
        using var db = NewContext();
        db.BidSheetLocations.AddRange(Location(1, "Mine"), Location(2, "Theirs", tradeUnit: "9999"));
        db.BidSheetLocationBids.AddRange(
            Bid(1, "YC", 2027, 3, "4.00"), Bid(1, "YC", 2026, 1, "4.00"), Bid(1, "SB", 2026, 1, "10.00"),
            Bid(1, "YC", 2026, 12, "4.00"), Bid(2, "WW", 2030, 6, "6.00"));
        await db.SaveChangesAsync();
        var repo = Repo(db);

        Assert.Equal(new[] { 2026, 2027 }, await repo.GetBidCropYearsAsync(Tu, CancellationToken.None));
        Assert.Equal(new[] { "SB", "YC" }, await repo.GetBidCommoditiesAsync(Tu, CancellationToken.None));
        Assert.Equal(new[] { 1, 12 }, await repo.GetBidMonthsAsync(Tu, 2026, CancellationToken.None));
    }

    // =========================================================================
    // Location writes
    // =========================================================================

    // -------------------------------------------------------------------------
    [Fact]
    public async Task UpdateLocationAsync_CopiesEditableFields_StampsModifiedAt_AndReturnsNullWhenMissing()
    {
        using var db = NewContext();
        db.BidSheetLocations.Add(Location(1, "Old"));
        await db.SaveChangesAsync();
        var repo = Repo(db);

        var updated = await repo.UpdateLocationAsync(1, new BidSheetLocation
        {
            Name = "New", City = "Madrid", State = "NE", Latitude = 41.5, Longitude = -96.2, IsScoularFacility = true,
            TradeUnitCode = "SHOULD-NOT-MOVE", ModifiedBy = User
        }, CancellationToken.None);

        Assert.NotNull(updated);
        Assert.Equal(("New", "Madrid", "NE", 41.5, -96.2, true, User), (updated!.Name, updated.City, updated.State, updated.Latitude, updated.Longitude, updated.IsScoularFacility, updated.ModifiedBy));
        Assert.Equal(Tu, updated.TradeUnitCode);          // a location never changes trade unit through an edit
        Assert.NotNull(updated.ModifiedAt);
        Assert.Null(await repo.UpdateLocationAsync(99, new BidSheetLocation { Name = "x" }, CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task CreateAndDeleteLocation_RoundTrip_AndDeleteOfMissingIdIsANoOp()
    {
        using var db = NewContext();
        var repo = Repo(db);

        var created = await repo.CreateLocationAsync(Location(0, "Fresh"), CancellationToken.None);
        Assert.True(created.Id > 0);

        await repo.DeleteLocationAsync(created.Id, CancellationToken.None);
        await repo.DeleteLocationAsync(created.Id, CancellationToken.None);   // second delete must not throw

        Assert.Equal(0, await db.BidSheetLocations.CountAsync());
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task DeleteBidsAsync_ByCommodity_OrByCommodityAndMonth()
    {
        using var db = NewContext();
        db.BidSheetLocations.Add(Location(1, "Mine"));
        db.BidSheetLocationBids.AddRange(
            Bid(1, "YC", 2026, 1, "4.00"), Bid(1, "YC", 2026, 2, "4.10"), Bid(1, "SB", 2026, 1, "10.00"));
        await db.SaveChangesAsync();
        var repo = Repo(db);

        await repo.DeleteBidsAsync(1, "YC", month: 2, CancellationToken.None);
        Assert.Equal(new[] { ("YC", 1), ("SB", 1) }, (await db.BidSheetLocationBids.ToListAsync()).Select(b => (b.CommodityCode, b.Month)));

        await repo.DeleteBidsAsync(1, "YC", month: null, CancellationToken.None);
        Assert.Equal(new[] { "SB" }, (await db.BidSheetLocationBids.ToListAsync()).Select(b => b.CommodityCode));

        await repo.DeleteBidsAsync(1, "NOPE", null, CancellationToken.None);   // nothing matched → no save, no throw
    }

    // =========================================================================
    // BulkUpsertBidsAsync
    // =========================================================================

    // -------------------------------------------------------------------------
    [Fact]
    public async Task BulkUpsert_CreatesMissingLocationsOnce_AndInsertsTheirBids()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.BulkUpsertBidsAsync(new[]
        {
            Input(" Madrid ", "YC", 2026, 1, "4.00", elevatorCode: "MAD"),
            Input("Madrid", "SB", 2026, 1, "10.00"),          // same location by trimmed name → not created twice
            Input(null, "YC", 2026, 1, "3.90", elevatorCode: "LIN"), // no name: elevator code becomes the name
        }, Tu, User, CancellationToken.None);

        var locations = await db.BidSheetLocations.OrderBy(l => l.Name).ToListAsync();
        Assert.Equal(new[] { ("LIN", "LIN"), ("Madrid", "MAD") }, locations.Select(l => (l.Name, l.ElevatorCode)));
        Assert.All(locations, l => Assert.Equal((Tu, User), (l.TradeUnitCode, l.CreatedBy)));

        var madrid = locations.Single(l => l.Name == "Madrid");
        var bids = await db.BidSheetLocationBids.Where(b => b.LocationId == madrid.Id).ToListAsync();
        Assert.Equal(new[] { "SB", "YC" }, bids.Select(b => b.CommodityCode).OrderBy(c => c));
        Assert.All(bids, b => Assert.Equal(User, b.CreatedBy));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task BulkUpsert_MatchesExistingLocationByElevatorCodeBeforeName()
    {
        using var db = NewContext();
        db.BidSheetLocations.AddRange(
            Location(1, "Madrid Elevator", elevatorCode: "MAD"),
            Location(2, "Madrid"));                            // a different location that happens to carry the name
        await db.SaveChangesAsync();
        var repo = Repo(db);

        await repo.BulkUpsertBidsAsync(new[] { Input("Madrid", "YC", 2026, 1, "4.00", elevatorCode: "MAD") }, Tu, User, CancellationToken.None);

        Assert.Equal(2, await db.BidSheetLocations.CountAsync());                // nothing new created
        var bid = await db.BidSheetLocationBids.SingleAsync();
        Assert.Equal(1, bid.LocationId);                                          // elevator-code match won
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task BulkUpsert_UpdatesExistingBid_CaseInsensitiveOnCommodity_AndStampsModifiedBy()
    {
        using var db = NewContext();
        db.BidSheetLocations.Add(Location(1, "Madrid"));
        db.BidSheetLocationBids.Add(Bid(1, "yc", 2026, 1, "4.00"));   // stored lowercase
        await db.SaveChangesAsync();
        var repo = Repo(db);

        await repo.BulkUpsertBidsAsync(new[] { Input("Madrid", "YC", 2026, 1, "4.25") }, Tu, User, CancellationToken.None);

        var bid = await db.BidSheetLocationBids.SingleAsync();                    // updated, not inserted alongside
        Assert.Equal(("4.25", User, "seed"), (bid.Bid, bid.ModifiedBy, bid.CreatedBy));
        Assert.NotNull(bid.ModifiedAt);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task BulkUpsert_BlankBid_DeletesTheExistingCell_AndNeverInsertsOne(string blank)
    {
        using var db = NewContext();
        db.BidSheetLocations.Add(Location(1, "Madrid"));
        db.BidSheetLocationBids.AddRange(Bid(1, "YC", 2026, 1, "4.00"), Bid(1, "YC", 2026, 2, "4.10"));
        await db.SaveChangesAsync();
        var repo = Repo(db);

        await repo.BulkUpsertBidsAsync(new[]
        {
            Input("Madrid", "YC", 2026, 1, blank),     // clears an existing cell
            Input("Madrid", "SB", 2026, 1, blank),     // clearing a cell that never existed → nothing inserted
        }, Tu, User, CancellationToken.None);

        var remaining = await db.BidSheetLocationBids.ToListAsync();
        Assert.Equal(new[] { ("YC", 2) }, remaining.Select(b => (b.CommodityCode, b.Month)));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task BulkUpsert_IgnoresLocationsBelongingToAnotherTradeUnit()
    {
        using var db = NewContext();
        db.BidSheetLocations.Add(Location(1, "Madrid", tradeUnit: "9999"));
        await db.SaveChangesAsync();
        var repo = Repo(db);

        await repo.BulkUpsertBidsAsync(new[] { Input("Madrid", "YC", 2026, 1, "4.00") }, Tu, User, CancellationToken.None);

        // The other trade unit's "Madrid" is invisible here, so a new one is created for this trade unit.
        Assert.Equal(2, await db.BidSheetLocations.CountAsync());
        var bid = await db.BidSheetLocationBids.SingleAsync();
        Assert.Equal(Tu, (await db.BidSheetLocations.SingleAsync(l => l.Id == bid.LocationId)).TradeUnitCode);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task BulkUpsert_EmptyRequest_IsANoOp()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.BulkUpsertBidsAsync([], Tu, User, CancellationToken.None);

        Assert.Equal(0, await db.BidSheetLocations.CountAsync());
        Assert.Equal(0, await db.BidSheetLocationBids.CountAsync());
    }

    // =========================================================================
    // Per-user order + preferences
    // =========================================================================

    // -------------------------------------------------------------------------
    [Fact]
    public async Task SetLocationOrderAsync_InsertsThenUpdatesTheSameRow()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.SetLocationOrderAsync(User, Tu, "[1,2]", CancellationToken.None);
        await repo.SetLocationOrderAsync(User, Tu, "[2,1]", CancellationToken.None);
        await repo.SetLocationOrderAsync(User, "9999", "[9]", CancellationToken.None);

        Assert.Equal(2, await db.BidSheetLocationOrders.CountAsync());
        Assert.Equal("[2,1]", (await repo.GetLocationOrderAsync(User, Tu, CancellationToken.None))!.LocationOrder);
        Assert.Null(await repo.GetLocationOrderAsync("someone-else", Tu, CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task SetPreferenceAsync_NullJsonFieldsLeaveExistingValuesAlone_ButScalarsAlwaysOverwrite()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.SetPreferenceAsync(User, Tu, "YC", 3, 2026, "[\"YC\"]", "[\"MILO\"]", "[3]", "{}", CancellationToken.None);
        await repo.SetPreferenceAsync(User, Tu, null, null, 2027, null, null, null, null, CancellationToken.None);

        var pref = await repo.GetPreferenceAsync(User, Tu, CancellationToken.None);
        Assert.NotNull(pref);
        Assert.Equal((null, null, 2027), (pref!.CropCode, pref.Month, pref.CropYear));                    // scalars track the latest call
        Assert.Equal(("[\"YC\"]", "[\"MILO\"]", "[3]", "{}"), (pref.CropOrder, pref.HiddenCrops, pref.SelectedMonths, pref.PrintLayout)); // JSON blobs are only replaced when sent
        Assert.Equal(1, await db.BidSheetPreferences.CountAsync());
    }
}
