using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// What the map's catalog popup is handed for one listing.
///
/// The popup answers a Cash/Basis/Both toggle, so the preview has to carry both prices for a period.
/// It used to collapse them: the de-duplication that picks one instrument per commodity and delivery
/// month grouped on (commodity, year, month) and left cash-versus-basis to the tie-break, whose last
/// step is the symbol -- and ZCB... sorts ahead of ZCPU..., so basis won almost every group. On the Dev
/// catalog that left 3,720 of 3,988 locations with no cash row at all, and the popup showed a basis
/// number under a column headed Price.
///
/// Runs against a real Azure SQL database (see BarchartIngestRepositoryIntegrationTests for the
/// connection-string setup); no-ops without one, and rolls back everything it writes.
/// </summary>
[Trait("Category", "Integration")]
[Collection("Database")]
public class BarchartCatalogBidPreviewTests : IAsyncLifetime
{
    private ApplicationDbContext _context = null!;
    private IDbContextTransaction _transaction = null!;
    private BarchartCatalogRepository _sut = null!;

    // A key the real vendor sweep does not issue, so this never collides with the live catalog.
    private const string LocationKey = "990911";

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
        _sut = new BarchartCatalogRepository(_context);
    }

    public async Task DisposeAsync()
    {
        if (!Enabled) return;

        await _transaction.RollbackAsync();
        await _transaction.DisposeAsync();
        await _context.DisposeAsync();
    }

    /// <summary>Cash and basis for the same corn month, plus a half-month cash split to prove the
    /// existing whole-month-wins ranking still runs inside each type.</summary>
    private async Task SeedAsync()
    {
        var start = new DateTime(2027, 12, 1);
        var end = new DateTime(2027, 12, 31);

        void Add(string symbol, string type, string? windowFlag, DateTime from, decimal price)
        {
            _context.BarchartInstruments.Add(new BarchartInstrument
            {
                Symbol = symbol,
                LocationKey = LocationKey,
                InstrumentType = type,
                DeliveryWindowFlag = windowFlag,
                Commodity = "Corn (#2 Yellow)",
                UnderlyingFuture = "ZCZ27",
                DeliveryStart = from,
                DeliveryEnd = end,
                IsActive = true,
                IsTest = false
            });
            _context.BarchartCurrentQuotes.Add(new BarchartCurrentQuote { Symbol = symbol, LastPrice = price });
        }

        Add($"ZCPZ27-{LocationKey}-1.CM", "bidCash", null, start, 4.55m);
        Add($"ZCBZ27-{LocationKey}-1.CM", "bidBasis", null, start, -42m);
        Add($"ZCPZ27L-{LocationKey}-1.CM", "bidCash", "L", new DateTime(2027, 12, 16), 4.61m);

        await _context.SaveChangesAsync();
    }

    [Fact]
    public async Task GetBidPreview_KeepsCashAndBasisAsSeparateRowsForTheSameMonth()
    {
        if (!Enabled) return;
        await SeedAsync();

        var bids = await _sut.GetBidPreviewAsync(LocationKey, null);

        Assert.Equal(2, bids.Count);
        var cash = Assert.Single(bids, b => !b.IsBasis);
        var basis = Assert.Single(bids, b => b.IsBasis);
        Assert.Equal(4.55m, cash.Price);
        Assert.Equal(-42m, basis.Price);
    }

    // The whole-month bid still beats the half-month split -- but only against its own price type,
    // which is the part that used to leak across.
    [Fact]
    public async Task GetBidPreview_StillCollapsesOverlappingWindowsWithinAPriceType()
    {
        if (!Enabled) return;
        await SeedAsync();

        var bids = await _sut.GetBidPreviewAsync(LocationKey, null);

        var cash = Assert.Single(bids, b => !b.IsBasis);
        Assert.Equal($"ZCPZ27-{LocationKey}-1.CM", cash.Symbol);
    }

    [Fact]
    public async Task GetBidPreview_ListsCashBeforeBasisSoAPairedRowReadsInThatOrder()
    {
        if (!Enabled) return;
        await SeedAsync();

        var bids = await _sut.GetBidPreviewAsync(LocationKey, null);

        Assert.False(bids[0].IsBasis);
        Assert.True(bids[1].IsBasis);
    }

    [Fact]
    public async Task GetBidPreview_StillHonoursAnExplicitInstrumentTypeFilter()
    {
        if (!Enabled) return;
        await SeedAsync();

        var basisOnly = await _sut.GetBidPreviewAsync(LocationKey, "bidBasis");

        Assert.All(basisOnly, b => Assert.True(b.IsBasis));
        Assert.Single(basisOnly);
    }
}
