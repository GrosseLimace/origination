using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging.Abstractions;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Covers the bid-sheet upsert write path, which had no tests at all despite being where every manual
/// bid a user types ends up — and which changed shape when manual bids gained a basis of their own.
///
/// A manual cell now carries the same two prices a fed cell does: cash and basis. Originators had been
/// typing a basis into the single Bid field for years ("-40Z" is forty under December), so that column
/// was migrated to BasisBid and cash became a separate thing they can fill in. These tests pin the
/// consequences of that: both prices round-trip, either one alone is valid, and a row only disappears
/// when both are gone.
///
/// Excluded from CI by the <c>Category=Integration</c> filter; runs against a real database because the
/// upsert's matching and delete rules are the behaviour under test. Every test rolls back.
/// </summary>
[Trait("Category", "Integration")]
[Collection("Database")]
public class BidSheetRepositoryUpsertTests : IAsyncLifetime
{
    private ApplicationDbContext _context = null!;
    private IDbContextTransaction _transaction = null!;
    private BidSheetRepository _sut = null!;

    private const string TradeUnit = "__IT_TU_UPSERT";

    private static string? ConnectionString =>
        Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection");

    private static bool Enabled => !string.IsNullOrWhiteSpace(ConnectionString);

    public async Task InitializeAsync()
    {
        if (!Enabled) return;

        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseSqlServer(ConnectionString!)
            .Options;

        _context = new ApplicationDbContext(options);
        _transaction = await _context.Database.BeginTransactionAsync();
        _sut = new BidSheetRepository(_context, NullLogger<BidSheetRepository>.Instance);
    }

    public async Task DisposeAsync()
    {
        if (!Enabled) return;

        await _transaction.RollbackAsync();
        await _transaction.DisposeAsync();
        await _context.DisposeAsync();
    }

    private static BidUpsertInput Input(int locationId, string bid, string basisBid) => new()
    {
        LocationId = locationId,
        CommodityCode = "IT_UPSERT",
        CropYear = 2027,
        Month = 12,
        Bid = bid,
        BasisBid = basisBid
    };

    /// <summary>
    /// Creates the location a test writes to. The upsert used to conjure one from a name it could not
    /// match, which is exactly the behaviour that had to go once locations became company-wide -- so
    /// every test now has to say which row it means, the same as the app does.
    /// </summary>
    private async Task<int> NewLocationAsync(string name)
    {
        var loc = new BidSheetLocation
        {
            Name = name,
            TradeUnitCode = TradeUnit,
            CreatedBy = "integration-test",
            CreatedAt = DateTime.UtcNow
        };
        _context.BidSheetLocations.Add(loc);
        await _context.SaveChangesAsync();
        return loc.Id;
    }

    private async Task<BidSheetLocationBid?> CellFor(string name) =>
        await _context.BidSheetLocationBids.AsNoTracking()
            .Where(b => b.Location!.Name == name && b.CommodityCode == "IT_UPSERT")
            .FirstOrDefaultAsync();

    [Fact]
    public async Task BulkUpsert_StoresCashAndBasisTogether()
    {
        if (!Enabled) return;

        var name = $"__IT Upsert Both {Guid.NewGuid():N}";
        var locationId = await NewLocationAsync(name);
        await _sut.BulkUpsertBidsAsync([Input(locationId, "4.98", "-30")], "integration-test", default);

        var cell = await CellFor(name);
        Assert.NotNull(cell);
        Assert.Equal("4.98", cell!.Bid);
        Assert.Equal("-30", cell.BasisBid);
        Assert.Equal(BidSources.Manual, cell.Source);
    }

    // Most competitor quotes are basis-only, which is exactly why the delete rule cannot key off cash.
    [Fact]
    public async Task BulkUpsert_AcceptsBasisWithNoCash()
    {
        if (!Enabled) return;

        var name = $"__IT Upsert Basis {Guid.NewGuid():N}";
        var locationId = await NewLocationAsync(name);
        await _sut.BulkUpsertBidsAsync([Input(locationId, "", "-40Z")], "integration-test", default);

        var cell = await CellFor(name);
        Assert.NotNull(cell);
        Assert.Equal(string.Empty, cell!.Bid);
        Assert.Equal("-40Z", cell.BasisBid);
    }

    [Fact]
    public async Task BulkUpsert_AcceptsCashWithNoBasis()
    {
        if (!Enabled) return;

        var name = $"__IT Upsert Cash {Guid.NewGuid():N}";
        var locationId = await NewLocationAsync(name);
        await _sut.BulkUpsertBidsAsync([Input(locationId, "4.98", "")], "integration-test", default);

        var cell = await CellFor(name);
        Assert.NotNull(cell);
        Assert.Equal("4.98", cell!.Bid);
        Assert.Null(cell.BasisBid);
    }

    // Clearing one price must not take the other with it. This is the rule that changed: the delete
    // used to fire on an empty cash, which would have thrown away the basis on most rows.
    [Fact]
    public async Task BulkUpsert_ClearingCashKeepsTheBasis()
    {
        if (!Enabled) return;

        var name = $"__IT Upsert Clear {Guid.NewGuid():N}";
        var locationId = await NewLocationAsync(name);
        await _sut.BulkUpsertBidsAsync([Input(locationId, "4.98", "-30")], "integration-test", default);
        await _sut.BulkUpsertBidsAsync([Input(locationId, "", "-30")], "integration-test", default);

        var cell = await CellFor(name);
        Assert.NotNull(cell);
        Assert.Equal(string.Empty, cell!.Bid);
        Assert.Equal("-30", cell.BasisBid);
    }

    [Fact]
    public async Task BulkUpsert_RemovesTheRowOnlyWhenBothPricesAreCleared()
    {
        if (!Enabled) return;

        var name = $"__IT Upsert Delete {Guid.NewGuid():N}";
        var locationId = await NewLocationAsync(name);
        await _sut.BulkUpsertBidsAsync([Input(locationId, "4.98", "-30")], "integration-test", default);
        Assert.NotNull(await CellFor(name));

        await _sut.BulkUpsertBidsAsync([Input(locationId, "", "")], "integration-test", default);
        Assert.Null(await CellFor(name));
    }

    // Overriding a fed cell is allowed, and ownership moves with the value. The cell becomes Manual so
    // the sheet shows it as hand-typed; the bridge's next run takes it back. That round trip is the
    // point -- an originator can correct a price today and the vendor reasserts tomorrow.
    [Fact]
    public async Task BulkUpsert_OverridesAFeedOwnedCellAndTakesOwnership()
    {
        if (!Enabled) return;

        var name = $"__IT Upsert Fed {Guid.NewGuid():N}";
        var location = new BidSheetLocation
        {
            Name = name,
            TradeUnitCode = TradeUnit,
            CreatedBy = "integration-test",
            CreatedAt = DateTime.UtcNow,
            Bids =
            [
                new BidSheetLocationBid
                {
                    CommodityCode = "IT_UPSERT",
                    CropYear = 2027,
                    Month = 12,
                    Bid = "4.98",
                    BasisBid = "-30",
                    Source = BidSources.Barchart,
                    CreatedBy = "barchart-feed",
                    CreatedAt = DateTime.UtcNow
                }
            ]
        };
        _context.BidSheetLocations.Add(location);
        await _context.SaveChangesAsync();

        await _sut.BulkUpsertBidsAsync([Input(location.Id, "9.99", "99")], "integration-test", default);

        var cell = await CellFor(name);
        Assert.NotNull(cell);
        Assert.Equal("9.99", cell!.Bid);
        Assert.Equal("99", cell.BasisBid);
        Assert.Equal(BidSources.Manual, cell.Source);
    }

    // Typing a basis over a cell the feed already owns must keep that basis and take the cell over. This
    // is the same assignment the reconcile path performs when two writes race, and that path had the
    // same defect -- it copied only the cash side, so a basis-only bid (the normal shape since manual
    // bids moved into BasisBid) lost the one value the user typed.
    //
    // NOTE: this exercises the ordinary update branch, NOT the reconcile. The repository shares this
    // test's DbContext, so a row inserted here is already tracked and the upsert finds it rather than
    // colliding on the unique index. Reaching the reconcile needs a second context committing between
    // the repository's read and its save -- a genuine race, and not something to fake with a timing
    // trick. The reconcile's own copy is reviewed but uncovered; recorded here so nobody reads this
    // test as proof of it.
    [Fact]
    public async Task BulkUpsert_KeepsTheBasisWhenTakingOverAFedCell()
    {
        if (!Enabled) return;

        var name = $"__IT Upsert Takeover {Guid.NewGuid():N}";
        var location = new BidSheetLocation
        {
            Name = name,
            TradeUnitCode = TradeUnit,
            CreatedBy = "integration-test",
            CreatedAt = DateTime.UtcNow,
            Bids =
            [
                new BidSheetLocationBid
                {
                    CommodityCode = "IT_UPSERT",
                    CropYear = 2027,
                    Month = 12,
                    Bid = string.Empty,
                    BasisBid = "-10",
                    Source = BidSources.Barchart,
                    CreatedBy = "barchart-feed",
                    CreatedAt = DateTime.UtcNow
                }
            ]
        };
        _context.BidSheetLocations.Add(location);
        await _context.SaveChangesAsync();

        await _sut.BulkUpsertBidsAsync([Input(location.Id, "", "-40Z")], "integration-test", default);

        var cell = await CellFor(name);
        Assert.NotNull(cell);
        Assert.Equal("-40Z", cell!.BasisBid);
        Assert.Equal(BidSources.Manual, cell.Source);
    }
}
