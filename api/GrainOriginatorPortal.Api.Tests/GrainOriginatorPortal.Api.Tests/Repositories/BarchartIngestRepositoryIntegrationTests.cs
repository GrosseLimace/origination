using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Exercises the BarChart feed SQL against a real Azure SQL database, because that SQL is where the
/// feature's logic actually lives — symbol parsing, upsert semantics, and the bid-sheet ownership
/// rules can't be verified against an in-memory provider (which style-guides/automated-testing.md §8
/// forbids for data tests anyway).
///
/// Excluded from CI by the <c>Category=Integration</c> filter. To run locally, point at a database
/// that has the migrations applied:
///   <c>$env:ConnectionStrings__DefaultConnection = 'Server=tcp:azrscosqld01.database.windows.net,1433;Database=Origination;Authentication=Active Directory Default;Encrypt=true;'</c>
///   <c>dotnet test --filter "Category=Integration"</c>
/// Without that variable the tests no-op, so a normal test run never reaches out to a database.
///
/// Every test runs inside a transaction that is rolled back, so nothing is left behind.
/// </summary>
[Trait("Category", "Integration")]
public class BarchartIngestRepositoryIntegrationTests : IAsyncLifetime
{
    private ApplicationDbContext _context = null!;
    private IDbContextTransaction _transaction = null!;
    private BarchartIngestRepository _sut = null!;

    private static string? ConnectionString =>
        Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection");

    private static bool Enabled => !string.IsNullOrWhiteSpace(ConnectionString);

    // Modelled on the vendor proof-of-concept extracts, but with location keys and commodity names the
    // vendor does not issue. That matters: these tests run against a shared database that now holds a
    // real BarChart sweep, so a fixture using real values collides with it -- the real catalog puts 63
    // instruments under GPC's actual key, and the real commodity seed already owns Corn (#2 Yellow),
    // which is a primary-key violation the moment a test inserts its own mapping. Every test here owns
    // its data outright and asserts only on rows it created.
    //
    // Three instruments must still collapse to one location: two half-month corn windows and a variant.
    private const string InstrumentsJson = """
        { "status": { "code": 200 }, "results": [
          { "symbol": "ZCPZ27F-990201-15194.CM", "symbolDescription": "Grain Processing Corporation Muscatine, IA Corn (IT Standard) 1/2 Dec 27 Cash",
            "elevator": "Grain Processing Corporation", "commodity": "Corn (IT Standard)", "underlyingFuture": "ZCZ27",
            "deliveryStart": "2027-12-08T00:00:00-05:00", "deliveryEnd": "2027-12-14T00:00:00-05:00",
            "location": "GPC-MUSCATINE", "facilityType": "River Terminal", "address": "1600 Dick Drake Hwy",
            "city": "Muscatine", "state": "IA", "zipCode": "52761", "longitude": "-91.0579", "latitude": "41.39298",
            "county": "Muscatine County", "countyFipsCode": "139", "stateFipsCode": "19" },
          { "symbol": "ZCPZ27L-990201-15194.CM", "symbolDescription": "Grain Processing Corporation Muscatine, IA Corn (IT Standard) 2/2 Dec 27 Cash",
            "elevator": "Grain Processing Corporation", "commodity": "Corn (IT Standard)", "underlyingFuture": "ZCZ27",
            "deliveryStart": "2027-12-22T00:00:00-05:00", "deliveryEnd": "2027-12-31T00:00:00-05:00",
            "location": "GPC-MUSCATINE", "facilityType": "River Terminal", "address": "1600 Dick Drake Hwy",
            "city": "Muscatine", "state": "IA", "zipCode": "52761", "longitude": "-91.0579", "latitude": "41.39298",
            "county": "Muscatine County", "countyFipsCode": "139", "stateFipsCode": "19" },
          { "symbol": "ZCPZ27-990201-15195.CM", "symbolDescription": "Grain Processing Corporation Muscatine, IA Corn (IT Variant) Dec 27 Cash",
            "elevator": "Grain Processing Corporation", "commodity": "Corn (IT Variant)", "underlyingFuture": "ZCZ27",
            "deliveryStart": "2027-10-01T00:00:00-05:00", "deliveryEnd": "2027-12-31T00:00:00-05:00",
            "location": "GPC-MUSCATINE", "facilityType": "River Terminal", "address": "1600 Dick Drake Hwy",
            "city": "Muscatine", "state": "IA", "zipCode": "52761", "longitude": "-91.0579", "latitude": "41.39298",
            "county": "Muscatine County", "countyFipsCode": "139", "stateFipsCode": "19" },
          { "symbol": "ZCPZ27-990202-6916.CM", "symbolDescription": "Little Sioux Corn Processors Marcus, IA Corn (IT Standard) Dec 27 Cash",
            "elevator": "Little Sioux Corn Processors", "commodity": "Corn (IT Standard)", "underlyingFuture": "ZCZ27",
            "deliveryStart": "2027-12-01T00:00:00-05:00", "deliveryEnd": "2027-12-31T00:00:00-05:00",
            "location": "LSCP", "facilityType": "Ethanol/Bio-Fuel", "address": "4808 F Avenue",
            "city": "Marcus", "state": "IA", "zipCode": "51035", "longitude": "-95.764286", "latitude": "42.821595",
            "county": "Cherokee County", "countyFipsCode": "035", "stateFipsCode": "19" },
          { "symbol": "ZCBZ27-990202-6916.CM", "symbolDescription": "Little Sioux Corn Processors Marcus, IA Corn (IT Standard) Dec 27 Basis",
            "elevator": "Little Sioux Corn Processors", "commodity": "Corn (IT Standard)", "underlyingFuture": "ZCZ27",
            "deliveryStart": "2027-12-01T00:00:00-05:00", "deliveryEnd": "2027-12-31T00:00:00-05:00",
            "location": "LSCP", "facilityType": "Ethanol/Bio-Fuel", "address": "4808 F Avenue",
            "city": "Marcus", "state": "IA", "zipCode": "51035", "longitude": "-95.764286", "latitude": "42.821595",
            "county": "Cherokee County", "countyFipsCode": "035", "stateFipsCode": "19" },
          { "symbol": "ZCPZ27-990203-17523.CM", "symbolDescription": "AgVance Bid Sync Test Allendorf, IA Corn (IT Standard) Dec 27 Cash",
            "elevator": "AgVance Bid Sync Test", "commodity": "Corn (IT Standard)", "underlyingFuture": "ZCZ27",
            "deliveryStart": "2027-12-01T00:00:00-05:00", "deliveryEnd": "2027-12-31T23:59:59-05:00",
            "location": "CFE Allendorf", "facilityType": "Country Elevator", "address": "1631 Highway 59",
            "city": "Allendorf", "state": "IA", "zipCode": "51354", "longitude": "-95.64386", "latitude": "43.413668",
            "county": "Osceola County", "countyFipsCode": "143", "stateFipsCode": "19" }
        ] }
        """;

    // The two GPC windows quote independently (4.47 first half, 4.53 second half) — a real spread.
    // The last entry is a symbol that isn't in the catalog and must be skipped, not inserted.
    private const string QuotesJson = """
        { "status": { "code": 200 }, "results": [
          { "symbol": "ZCPZ27F-990201-15194.CM", "lastPrice": "4.47", "netChange": "0.0625",
            "tradeTimestamp": "2026-07-22T12:12:36-05:00", "serverTimestamp": "2026-07-22T12:12:42-05:00",
            "dayCode": "L", "mode": "i", "unitCode": "4", "code": 200 },
          { "symbol": "ZCPZ27L-990201-15194.CM", "lastPrice": "4.53", "netChange": "0.0825",
            "tradeTimestamp": "2026-07-22T12:12:36-05:00", "serverTimestamp": "2026-07-22T12:12:42-05:00",
            "dayCode": "L", "mode": "i", "unitCode": "4", "code": 200 },
          { "symbol": "ZCPZ27-990201-15195.CM", "lastPrice": "4.47", "netChange": "0.0825",
            "tradeTimestamp": "2026-07-22T12:12:37-05:00", "dayCode": "L", "mode": "i", "unitCode": "4", "code": 200 },
          { "symbol": "ZCPZ27-990202-6916.CM", "lastPrice": "4.41", "netChange": "0.0825",
            "tradeTimestamp": "2026-07-22T12:13:57-05:00", "dayCode": "L", "mode": "i", "unitCode": "4", "code": 200 },
          { "symbol": "ZCPZ27-990203-17523.CM", "lastPrice": "4.13", "netChange": "0.0325",
            "tradeTimestamp": "2026-07-21T21:32:32-05:00", "dayCode": "K", "mode": "i", "unitCode": "4", "code": 200 },
          { "symbol": "ZZ-NOT-IN-CATALOG.CM", "lastPrice": "1.23", "code": 200 }
        ] }
        """;

    private static readonly DateOnly BusinessDate = new(2026, 7, 22);

    public async Task InitializeAsync()
    {
        if (!Enabled) return;

        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseSqlServer(ConnectionString!)
            .Options;

        _context = new ApplicationDbContext(options);
        _transaction = await _context.Database.BeginTransactionAsync();
        _sut = new BarchartIngestRepository(_context);
    }

    public async Task DisposeAsync()
    {
        if (!Enabled) return;

        await _transaction.RollbackAsync();
        await _transaction.DisposeAsync();
        await _context.DisposeAsync();
    }

    [Fact]
    public async Task LoadInstruments_ParsesSymbolAnatomyGroupsByLocationAndFlagsVendorTestRows()
    {
        if (!Enabled) return;

        var loaded = await _sut.LoadInstrumentsAsync(InstrumentsJson);
        Assert.Equal(6, loaded);

        // The middle symbol segment is the elevator listing id, so GPC's three instruments share it.
        var gpc = await _context.BarchartInstruments.AsNoTracking()
            .Where(i => i.LocationKey == "990201")
            .ToListAsync();
        Assert.Equal(3, gpc.Count);

        var firstHalf = gpc.Single(i => i.Symbol == "ZCPZ27F-990201-15194.CM");
        Assert.Equal("ZC", firstHalf.Root);
        Assert.Equal("bidCash", firstHalf.InstrumentType);
        Assert.Equal("F", firstHalf.DeliveryWindowFlag);
        Assert.False(firstHalf.IsTest);
        // Vendor sends -05:00; storage is UTC, so 00:00 Central on 8 Aug is 05:00 UTC.
        Assert.Equal(new DateTime(2027, 12, 8, 5, 0, 0, DateTimeKind.Unspecified), firstHalf.DeliveryStart);

        var wholeMonth = gpc.Single(i => i.Symbol == "ZCPZ27-990201-15195.CM");
        Assert.Null(wholeMonth.DeliveryWindowFlag);

        // Vendor test data must be flagged so it can never surface in the application.
        var agVance = await _context.BarchartInstruments.AsNoTracking()
            .SingleAsync(i => i.Symbol == "ZCPZ27-990203-17523.CM");
        Assert.True(agVance.IsTest);

        // Re-loading the same payload updates rather than duplicates.
        var reloaded = await _sut.LoadInstrumentsAsync(InstrumentsJson);
        Assert.Equal(6, reloaded);
        Assert.Equal(6, await _context.BarchartInstruments.CountAsync(
            i => i.LocationKey == "990201" || i.LocationKey == "990202" || i.LocationKey == "990203"));
    }

    [Fact]
    public async Task LoadQuotes_WritesCurrentPriceAndDailyHistory_SkipsUnknownSymbols_AndIsIdempotentPerDate()
    {
        if (!Enabled) return;

        await _sut.LoadInstrumentsAsync(InstrumentsJson);

        var first = await _sut.LoadQuotesAsync(QuotesJson, BusinessDate);

        Assert.Equal(5, first.QuotesUpserted);
        Assert.Equal(1, first.UnknownSymbolCount);
        Assert.False(await _context.BarchartCurrentQuotes.AnyAsync(q => q.Symbol == "ZZ-NOT-IN-CATALOG.CM"));

        var secondHalf = await _context.BarchartCurrentQuotes.AsNoTracking()
            .SingleAsync(q => q.Symbol == "ZCPZ27L-990201-15194.CM");
        Assert.Equal(4.53m, secondHalf.LastPrice);
        Assert.Equal(new DateTime(2026, 7, 22, 17, 12, 36, DateTimeKind.Unspecified), secondHalf.TradeTimestamp);

        var historyAfterFirst = await _context.BarchartQuoteSnapshots
            .CountAsync(s => s.SnapshotDate == BusinessDate);
        Assert.Equal(5, historyAfterFirst);

        // Re-running the same business date replaces the day's rows — this is what makes the ingest
        // endpoints safe for the pipeline to retry.
        await _sut.LoadQuotesAsync(QuotesJson, BusinessDate);
        Assert.Equal(historyAfterFirst,
            await _context.BarchartQuoteSnapshots.CountAsync(s => s.SnapshotDate == BusinessDate));
    }

    [Fact]
    public async Task GetQuoteBatches_ExcludesVendorTestInstruments()
    {
        if (!Enabled) return;

        await _sut.LoadInstrumentsAsync(InstrumentsJson);

        var batches = await _sut.GetQuoteBatchesAsync(batchSize: 1000);
        var allSymbols = string.Join(",", batches.Select(b => b.SymbolsCsv));

        Assert.Contains("ZCPZ27-990202-6916.CM", allSymbols);
        Assert.DoesNotContain("990203", allSymbols);
    }

    [Fact]
    public async Task ApplyBids_PicksTheWiderWindow_SkipsUnmappedCommodities_AndNeverOverwritesManualBids()
    {
        if (!Enabled) return;

        await _sut.LoadInstrumentsAsync(InstrumentsJson);
        await _sut.LoadQuotesAsync(QuotesJson, BusinessDate);

        // "Corn (IT Variant)" is deliberately left unmapped, so it must not reach the Bid Sheet.
        _context.BarchartCommodityMaps.Add(new BarchartCommodityMap
        {
            BarchartCommodity = "Corn (IT Standard)",
            CommodityCode = "IT_CORN",
            CommodityName = "Corn",
            CommodityCategory = "Grains",
            CreatedBy = "integration-test"
        });

        var gpcLocation = NewLinkedLocation("__IT GPC Muscatine", "990201");
        var siouxLocation = NewLinkedLocation("__IT Little Sioux", "990202");
        _context.BidSheetLocations.AddRange(gpcLocation, siouxLocation);
        await _context.SaveChangesAsync();

        // A hand-typed bid in the exact cell the feed would target.
        _context.BidSheetLocationBids.Add(new BidSheetLocationBid
        {
            LocationId = siouxLocation.Id,
            CommodityCode = "IT_CORN",
            CropYear = 2027,
            Month = 12,
            Bid = "9.99",
            Source = BidSources.Manual,
            CreatedBy = "integration-test",
            CreatedAt = DateTime.UtcNow
        });
        await _context.SaveChangesAsync();

        await _sut.ApplyBidsToBidSheetAsync(locationId: null, instrumentType: "bidCash", appliedBy: "barchart-feed");

        // GPC's December cell has no whole-month corn bid, so the wider half-month window wins (4.53,
        // Aug 22-31 spans 9 days versus 6 for the first half).
        var gpcBids = await _context.BidSheetLocationBids.AsNoTracking()
            .Where(b => b.LocationId == gpcLocation.Id)
            .ToListAsync();
        var gpcDecember = Assert.Single(gpcBids);
        Assert.Equal("4.53", gpcDecember.Bid);
        Assert.Equal(BidSources.Barchart, gpcDecember.Source);
        Assert.Equal("ZCPZ27L-990201-15194.CM", gpcDecember.BarchartSymbol);
        Assert.NotNull(gpcDecember.QuoteAsOf);
        Assert.Equal(2027, gpcDecember.CropYear);
        Assert.Equal(12, gpcDecember.Month);

        // The manual bid is untouched — the feed owns its own cells only.
        var manual = await _context.BidSheetLocationBids.AsNoTracking()
            .SingleAsync(b => b.LocationId == siouxLocation.Id);
        Assert.Equal("9.99", manual.Bid);
        Assert.Equal(BidSources.Manual, manual.Source);
        Assert.Null(manual.QuoteAsOf);

        // Re-running changes nothing: no duplicate rows, no ModifiedAt churn.
        await _sut.ApplyBidsToBidSheetAsync(null, "bidCash", "barchart-feed");
        Assert.Equal(2, await _context.BidSheetLocationBids
            .CountAsync(b => b.LocationId == gpcLocation.Id || b.LocationId == siouxLocation.Id));
    }

    [Fact]
    public async Task ApplyBids_PrunesItsOwnRowsWhenAMappingIsSwitchedOff_ButLeavesManualBidsStanding()
    {
        if (!Enabled) return;

        await _sut.LoadInstrumentsAsync(InstrumentsJson);
        await _sut.LoadQuotesAsync(QuotesJson, BusinessDate);

        var map = new BarchartCommodityMap
        {
            BarchartCommodity = "Corn (IT Standard)",
            CommodityCode = "IT_CORN",
            CommodityName = "Corn",
            CreatedBy = "integration-test"
        };
        _context.BarchartCommodityMaps.Add(map);

        var gpcLocation = NewLinkedLocation("__IT GPC Prune", "990201");
        _context.BidSheetLocations.Add(gpcLocation);
        await _context.SaveChangesAsync();

        // A manual bid for a month the feed doesn't cover — it must survive the prune.
        _context.BidSheetLocationBids.Add(new BidSheetLocationBid
        {
            LocationId = gpcLocation.Id,
            CommodityCode = "IT_CORN",
            CropYear = 2027,
            Month = 6,
            Bid = "5.55",
            Source = BidSources.Manual,
            CreatedBy = "integration-test",
            CreatedAt = DateTime.UtcNow
        });
        await _context.SaveChangesAsync();

        await _sut.ApplyBidsToBidSheetAsync(null, "bidCash", "barchart-feed");
        Assert.True(await _context.BidSheetLocationBids
            .AnyAsync(b => b.LocationId == gpcLocation.Id && b.Source == BidSources.Barchart));

        // Turning the mapping off removes the feed's cells on the next run.
        map.IsActive = false;
        await _context.SaveChangesAsync();

        await _sut.ApplyBidsToBidSheetAsync(null, "bidCash", "barchart-feed");

        Assert.False(await _context.BidSheetLocationBids
            .AnyAsync(b => b.LocationId == gpcLocation.Id && b.Source == BidSources.Barchart));
        var survivor = await _context.BidSheetLocationBids.AsNoTracking()
            .SingleAsync(b => b.LocationId == gpcLocation.Id);
        Assert.Equal("5.55", survivor.Bid);
    }

    /// <summary>
    /// A Bid Sheet location linked to a BarChart listing. Names are suffixed so repeated local runs
    /// can't collide on the (Name, TradeUnitCode) unique index even though each run rolls back.
    /// </summary>
    private static BidSheetLocation NewLinkedLocation(string name, string locationKey) => new()
    {
        Name = $"{name} {Guid.NewGuid():N}"[..Math.Min(200, name.Length + 33)],
        City = "Muscatine",
        State = "IA",
        BarchartLocationKey = locationKey,
        TradeUnitCode = "__IT_TU",
        CreatedBy = "integration-test",
        CreatedAt = DateTime.UtcNow
    };

    // -------------------------------------------------------------------------
    // The first live quote run (2026-08-21) showed the vendor mixes three populations in one payload:
    // fresh quotes, quotes averaging 181 days old, and placeholders (0.0025, and the sentinel
    // 214748.3647 = int.MaxValue / 10000). A stale or sentinel price on the sheet is worse than a blank
    // cell -- it put soybeans at $3.51 for one month beside $11.70 either side of it, which reads as a
    // market move rather than as missing data.
    [Fact]
    public async Task ApplyBids_SkipsStalePlaceholderAndSentinelPrices()
    {
        if (!Enabled) return;

        await _sut.LoadInstrumentsAsync(InstrumentsJson);

        var mixedQuotes = """
            { "status": { "code": 200 }, "results": [
              { "symbol": "ZCPZ27F-990201-15194.CM", "lastPrice": "4.47",
                "tradeTimestamp": "REPLACE_FRESH", "mode": "i", "unitCode": "4", "code": 200 },
              { "symbol": "ZCPZ27L-990201-15194.CM", "lastPrice": "214748.3647",
                "tradeTimestamp": "REPLACE_FRESH", "mode": "d", "unitCode": "4", "code": 200 },
              { "symbol": "ZCPZ27-990202-6916.CM", "lastPrice": "3.51",
                "tradeTimestamp": "REPLACE_STALE", "mode": "d", "unitCode": "4", "code": 200 },
              { "symbol": "ZCPZ27-990203-17523.CM", "lastPrice": "0.0025",
                "tradeTimestamp": "REPLACE_FRESH", "mode": "i", "unitCode": "4", "code": 200 }
            ] }
            """
            .Replace("REPLACE_FRESH", DateTime.UtcNow.AddHours(-2).ToString("yyyy-MM-ddTHH:mm:sszzz"))
            .Replace("REPLACE_STALE", DateTime.UtcNow.AddDays(-262).ToString("yyyy-MM-ddTHH:mm:sszzz"));

        await _sut.LoadQuotesAsync(mixedQuotes, BusinessDate);

        _context.BarchartCommodityMaps.Add(new BarchartCommodityMap
        {
            BarchartCommodity = "Corn (IT Standard)",
            CommodityCode = "IT_CORN",
            CommodityName = "Corn",
            CommodityCategory = "Grains",
            CreatedBy = "integration-test"
        });
        var gpc = NewLinkedLocation("__IT GPC Quality", "990201");
        var sioux = NewLinkedLocation("__IT Sioux Quality", "990202");
        var third = NewLinkedLocation("__IT Placeholder Quality", "990203");
        _context.BidSheetLocations.AddRange(gpc, sioux, third);
        await _context.SaveChangesAsync();

        await _sut.ApplyBidsToBidSheetAsync(null, "bidCash", "barchart-feed");

        var gpcCells = await _context.BidSheetLocationBids.Where(b => b.LocationId == gpc.Id).ToListAsync();
        var siouxCells = await _context.BidSheetLocationBids.Where(b => b.LocationId == sioux.Id).ToListAsync();
        var thirdCells = await _context.BidSheetLocationBids.Where(b => b.LocationId == third.Id).ToListAsync();

        // The fresh, plausible price publishes -- and the sentinel does not win its cell despite being
        // the wider delivery window, which is what the ranking would otherwise have preferred.
        Assert.Equal("4.47", Assert.Single(gpcCells).Bid);
        // A 262-day-old quote is not published at all.
        Assert.Empty(siouxCells);
        // Neither is a no-bid placeholder.
        Assert.Empty(thirdCells);
    }

    // A second synthetic location, kept separate from the shared fixture so the contract-month rules can
    // be asserted without the half-month windows above muddying the winner selection.
    private const string ContractMonthInstrumentsJson = """
        { "status": { "code": 200 }, "results": [
          { "symbol": "ZCPZ27-990001-990010.CM", "symbolDescription": "IT Contract Month Elevator Corn (IT Flexible) Dec 27 Cash",
            "elevator": "IT Contract Month Elevator", "commodity": "Corn (IT Flexible)", "underlyingFuture": "ZCZ27",
            "deliveryStart": "2027-10-01T00:00:00-05:00", "deliveryEnd": "2027-12-31T00:00:00-05:00",
            "location": "IT-CONTRACT-MONTH", "facilityType": "Country Elevator", "address": "1 Test Road",
            "city": "Testville", "state": "IA", "zipCode": "50001" },
          { "symbol": "ZCPZ27F-990001-990011.CM", "symbolDescription": "IT Contract Month Elevator Corn (IT Split) 1/2 Dec 27 Cash",
            "elevator": "IT Contract Month Elevator", "commodity": "Corn (IT Split)", "underlyingFuture": "ZCZ27",
            "deliveryStart": "2027-12-08T00:00:00-05:00", "deliveryEnd": "2027-12-14T00:00:00-05:00",
            "location": "IT-CONTRACT-MONTH", "facilityType": "Country Elevator", "address": "1 Test Road",
            "city": "Testville", "state": "IA", "zipCode": "50001" },
          { "symbol": "ZCPZ27L-990001-990011.CM", "symbolDescription": "IT Contract Month Elevator Corn (IT Split) 2/2 Dec 27 Cash",
            "elevator": "IT Contract Month Elevator", "commodity": "Corn (IT Split)", "underlyingFuture": "ZCZ27",
            "deliveryStart": "2027-12-22T00:00:00-05:00", "deliveryEnd": "2027-12-31T00:00:00-05:00",
            "location": "IT-CONTRACT-MONTH", "facilityType": "Country Elevator", "address": "1 Test Road",
            "city": "Testville", "state": "IA", "zipCode": "50001" }
        ] }
        """;

    private const string ContractMonthQuotesJson = """
        { "status": { "code": 200 }, "results": [
          { "symbol": "ZCPZ27-990001-990010.CM", "lastPrice": "4.47",
            "tradeTimestamp": "2026-07-22T12:12:36-05:00", "mode": "i", "unitCode": "4", "code": 200 },
          { "symbol": "ZCPZ27F-990001-990011.CM", "lastPrice": "4.41",
            "tradeTimestamp": "2026-07-22T12:12:36-05:00", "mode": "i", "unitCode": "4", "code": 200 },
          { "symbol": "ZCPZ27L-990001-990011.CM", "lastPrice": "4.53",
            "tradeTimestamp": "2026-07-22T12:12:36-05:00", "mode": "i", "unitCode": "4", "code": 200 }
        ] }
        """;

    private async Task<BidSheetLocation> SeedContractMonthCatalogAsync()
    {
        await _sut.LoadInstrumentsAsync(ContractMonthInstrumentsJson);
        await _sut.LoadQuotesAsync(ContractMonthQuotesJson, BusinessDate);

        _context.BarchartCommodityMaps.AddRange(
            new BarchartCommodityMap
            {
                BarchartCommodity = "Corn (IT Flexible)",
                CommodityCode = "IT_FLEX",
                CommodityName = "Corn (IT Flexible)",
                CommodityCategory = "Grains",
                CreatedBy = "integration-test"
            },
            new BarchartCommodityMap
            {
                BarchartCommodity = "Corn (IT Split)",
                CommodityCode = "IT_SPLIT",
                CommodityName = "Corn (IT Split)",
                CommodityCategory = "Grains",
                CreatedBy = "integration-test"
            });

        var location = NewLinkedLocation("__IT Contract Month", "990001");
        _context.BidSheetLocations.Add(location);
        await _context.SaveChangesAsync();
        return location;
    }

    // The vendor names the contract month in the symbol and uses the delivery window only to say how
    // much flexibility that contract carries, so the two disagree whenever an elevator allows early or
    // late delivery. ZCPZ27 is the August contract (Q) even though it accepts delivery from 1 June.
    // Keying the cell off the window start filed it under June -- and on the live feed that mis-filed
    // 9,623 of 61,387 instruments, most visibly at Herkimer, where November's price sat in the October
    // cell while November itself stayed blank.
    [Fact]
    public async Task ApplyBids_FilesABidUnderItsContractMonth_NotTheMonthTheWindowStartsIn()
    {
        if (!Enabled) return;

        var location = await SeedContractMonthCatalogAsync();

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        var cell = await _context.BidSheetLocationBids.AsNoTracking()
            .SingleAsync(b => b.LocationId == location.Id && b.CommodityCode == "IT_FLEX");

        // August, from the Q in ZCPZ27 -- not June, where the 1 Jun - 31 Aug window begins.
        Assert.Equal(2027, cell.CropYear);
        Assert.Equal(12, cell.Month);
        Assert.Equal("ZCPZ27-990001-990010.CM", cell.BarchartSymbol);
        Assert.Equal("4.47", cell.Bid);
    }

    // Half-month splits carry an F/L suffix after the year, which is the shape most likely to trip a
    // stricter parse. Both halves must still read as August and collapse into the one August cell.
    [Fact]
    public async Task ApplyBids_ReadsTheContractMonthThroughAHalfMonthSuffix()
    {
        if (!Enabled) return;

        var location = await SeedContractMonthCatalogAsync();

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        var cell = await _context.BidSheetLocationBids.AsNoTracking()
            .SingleAsync(b => b.LocationId == location.Id && b.CommodityCode == "IT_SPLIT");

        Assert.Equal(2027, cell.CropYear);
        Assert.Equal(12, cell.Month);
        // Neither half covers the whole month, so the wider second half wins the cell.
        Assert.Equal("ZCPZ27L-990001-990011.CM", cell.BarchartSymbol);
        Assert.Equal("4.53", cell.Bid);
    }

    // An elevator that posts a bid and then leaves it alone is behaving normally, especially on a
    // deferred month -- so a LIVE quote publishes however old it is. Age used to be the test, and it hid
    // real bids: on the live feed no mode-i quote exceeds 90 days, so age was only ever a proxy for mode.
    [Fact]
    public async Task ApplyBids_PublishesALiveQuoteThatHasNotMovedInWeeks()
    {
        if (!Enabled) return;

        await _sut.LoadInstrumentsAsync(InstrumentsJson);

        var unmoved = """
            { "status": { "code": 200 }, "results": [
              { "symbol": "ZCPZ27-990202-6916.CM", "lastPrice": "4.41",
                "tradeTimestamp": "REPLACE_OLD", "mode": "i", "unitCode": "4", "code": 200 }
            ] }
            """.Replace("REPLACE_OLD", DateTime.UtcNow.AddDays(-30).ToString("yyyy-MM-ddTHH:mm:sszzz"));
        await _sut.LoadQuotesAsync(unmoved, BusinessDate);

        _context.BarchartCommodityMaps.Add(new BarchartCommodityMap
        {
            BarchartCommodity = "Corn (IT Standard)",
            CommodityCode = "IT_CORN",
            CreatedBy = "integration-test"
        });
        var sioux = NewLinkedLocation("__IT Sioux Unmoved", "990202");
        _context.BidSheetLocations.Add(sioux);
        await _context.SaveChangesAsync();

        await _sut.ApplyBidsToBidSheetAsync(null, "bidCash", "barchart-feed");

        var cells = await _context.BidSheetLocationBids.Where(b => b.LocationId == sioux.Id).ToListAsync();
        Assert.Equal("4.41", Assert.Single(cells).Bid);
    }

    // -------------------------------------------------------------------------
    // Basis publishes onto the SAME row as cash, into its own columns. It is normally negative
    // (-30 reads as thirty under), which is exactly why it can't share the cash price floor: the
    // 0.01 minimum that screens out the vendor's no-bid placeholder would reject every basis quote.
    [Fact]
    public async Task ApplyBids_PublishesBasisAlongsideCash_AndKeepsNegativeValues()
    {
        if (!Enabled) return;

        await _sut.LoadInstrumentsAsync(InstrumentsJson);

        var fresh = DateTime.UtcNow.AddHours(-1).ToString("yyyy-MM-ddTHH:mm:sszzz");
        var quotes = """
            { "status": { "code": 200 }, "results": [
              { "symbol": "ZCPZ27-990202-6916.CM", "lastPrice": "4.41",
                "tradeTimestamp": "REPLACE", "mode": "i", "unitCode": "4", "code": 200 },
              { "symbol": "ZCBZ27-990202-6916.CM", "lastPrice": "-30",
                "tradeTimestamp": "REPLACE", "mode": "i", "unitCode": "4", "code": 200 }
            ] }
            """.Replace("REPLACE", fresh);
        await _sut.LoadQuotesAsync(quotes, BusinessDate);

        _context.BarchartCommodityMaps.Add(new BarchartCommodityMap
        {
            BarchartCommodity = "Corn (IT Standard)",
            CommodityCode = "IT_CORN",
            CreatedBy = "integration-test"
        });
        var loc = NewLinkedLocation("__IT Basis Pairing", "990202");
        _context.BidSheetLocations.Add(loc);
        await _context.SaveChangesAsync();

        await _sut.ApplyBidsToBidSheetAsync(null, "bidCash", "barchart-feed");

        var cell = await _context.BidSheetLocationBids.SingleAsync(b => b.LocationId == loc.Id);
        Assert.Equal("4.41", cell.Bid);
        // Minus sign preserved, and no trailing zeros -- an originator reads 30 under, not -30.00.
        Assert.Equal("-30", cell.BasisBid);
        Assert.Equal(BidSources.Barchart, cell.Source);
    }

    // A manual cell is off limits to both prices, not just the cash one -- otherwise the feed could
    // half-write a row a user owns.
    [Fact]
    public async Task ApplyBids_DoesNotAttachBasisToAManualBid()
    {
        if (!Enabled) return;

        await _sut.LoadInstrumentsAsync(InstrumentsJson);
        var fresh = DateTime.UtcNow.AddHours(-1).ToString("yyyy-MM-ddTHH:mm:sszzz");
        await _sut.LoadQuotesAsync("""
            { "status": { "code": 200 }, "results": [
              { "symbol": "ZCBZ27-990202-6916.CM", "lastPrice": "-30",
                "tradeTimestamp": "REPLACE", "mode": "i", "unitCode": "4", "code": 200 }
            ] }
            """.Replace("REPLACE", fresh), BusinessDate);

        _context.BarchartCommodityMaps.Add(new BarchartCommodityMap
        {
            BarchartCommodity = "Corn (IT Standard)", CommodityCode = "IT_CORN", CreatedBy = "integration-test"
        });
        var loc = NewLinkedLocation("__IT Basis Manual", "990202");
        _context.BidSheetLocations.Add(loc);
        await _context.SaveChangesAsync();

        _context.BidSheetLocationBids.Add(new BidSheetLocationBid
        {
            LocationId = loc.Id, CommodityCode = "IT_CORN", CropYear = 2027, Month = 12,
            Bid = "9.99", Source = BidSources.Manual, CreatedBy = "integration-test", CreatedAt = DateTime.UtcNow
        });
        await _context.SaveChangesAsync();

        await _sut.ApplyBidsToBidSheetAsync(null, "bidCash", "barchart-feed");

        var cell = await _context.BidSheetLocationBids.SingleAsync(b => b.LocationId == loc.Id);
        Assert.Equal("9.99", cell.Bid);
        Assert.Null(cell.BasisBid);
        Assert.Equal(BidSources.Manual, cell.Source);
    }
}
