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
[Collection("Database")]
public class BarchartIngestRepositoryIntegrationTests : IAsyncLifetime
{
    private ApplicationDbContext _context = null!;
    private IDbContextTransaction _transaction = null!;
    private BarchartIngestRepository _sut = null!;

    private static string? ConnectionString =>
        Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection");

    private static bool Enabled => !string.IsNullOrWhiteSpace(ConnectionString);

    // Every vendor timestamp in this file is relative to the clock. The fixtures used to hard-code
    // 2026-07-22 and the whole file went red the day that crossed the 90-day publish window.
    //
    // DateTimeOffset, not DateTime.UtcNow: formatted with zzz, a UTC DateTime is printed with the
    // MACHINE's local offset, which the loader then applies -- so a "two hours ago" stamp landed up to
    // five hours in the future. Tests that compare a quote against an edit time need the real instant.
    private static string Stamp(TimeSpan ago)
        => DateTimeOffset.UtcNow.Subtract(ago).ToString("yyyy-MM-dd'T'HH:mm:sszzz");
    private static string HoursAgo(int hours) => Stamp(TimeSpan.FromHours(hours));
    private static string DaysAgo(int days) => Stamp(TimeSpan.FromDays(days));

    /// <summary>Fills a fixture's STAMP_1D / STAMP_2D tokens at call time, so each test gets a live date.</summary>
    private static string Dated(string quotesJson)
        => quotesJson
            // The same instant written the way the vendor writes it, in Central time -- so one row still
            // exercises the loader's offset handling. Replaced first: it shares a prefix with STAMP_1D.
            .Replace("STAMP_1D_CENTRAL",
                DateTimeOffset.UtcNow.AddDays(-1).ToOffset(TimeSpan.FromHours(-5)).ToString("yyyy-MM-dd'T'HH:mm:sszzz"))
            .Replace("STAMP_1D", DaysAgo(1))
            .Replace("STAMP_2D", DaysAgo(2));

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
            "tradeTimestamp": "STAMP_1D", "serverTimestamp": "STAMP_1D",
            "dayCode": "L", "mode": "i", "unitCode": "4", "code": 200 },
          { "symbol": "ZCPZ27L-990201-15194.CM", "lastPrice": "4.53", "netChange": "0.0825",
            "tradeTimestamp": "STAMP_1D_CENTRAL", "serverTimestamp": "STAMP_1D",
            "dayCode": "L", "mode": "i", "unitCode": "4", "code": 200 },
          { "symbol": "ZCPZ27-990201-15195.CM", "lastPrice": "4.47", "netChange": "0.0825",
            "tradeTimestamp": "STAMP_1D", "dayCode": "L", "mode": "i", "unitCode": "4", "code": 200 },
          { "symbol": "ZCPZ27-990202-6916.CM", "lastPrice": "4.41", "netChange": "0.0825",
            "tradeTimestamp": "STAMP_1D", "dayCode": "L", "mode": "i", "unitCode": "4", "code": 200 },
          { "symbol": "ZCPZ27-990203-17523.CM", "lastPrice": "4.13", "netChange": "0.0325",
            "tradeTimestamp": "STAMP_2D", "dayCode": "K", "mode": "i", "unitCode": "4", "code": 200 },
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

        var first = await _sut.LoadQuotesAsync(Dated(QuotesJson), BusinessDate);

        Assert.Equal(5, first.QuotesUpserted);
        Assert.Equal(1, first.UnknownSymbolCount);
        Assert.False(await _context.BarchartCurrentQuotes.AnyAsync(q => q.Symbol == "ZZ-NOT-IN-CATALOG.CM"));

        var secondHalf = await _context.BarchartCurrentQuotes.AsNoTracking()
            .SingleAsync(q => q.Symbol == "ZCPZ27L-990201-15194.CM");
        Assert.Equal(4.53m, secondHalf.LastPrice);
        // Stored as UTC: this row's stamp is written with a -05:00 offset (see Dated), so landing within
        // minutes of a day ago proves the offset was applied rather than dropped.
        Assert.NotNull(secondHalf.TradeTimestamp);
        Assert.InRange(secondHalf.TradeTimestamp!.Value,
            DateTime.UtcNow.AddDays(-1).AddMinutes(-5), DateTime.UtcNow.AddDays(-1).AddMinutes(5));

        var historyAfterFirst = await _context.BarchartQuoteSnapshots
            .CountAsync(s => s.SnapshotDate == BusinessDate);
        Assert.Equal(5, historyAfterFirst);

        // Re-running the same business date replaces the day's rows — this is what makes the ingest
        // endpoints safe for the pipeline to retry.
        await _sut.LoadQuotesAsync(Dated(QuotesJson), BusinessDate);
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
    public async Task ApplyBids_PicksTheWiderWindow_SkipsUnmappedCommodities_AndLeavesUnrelatedManualBids()
    {
        if (!Enabled) return;

        await _sut.LoadInstrumentsAsync(InstrumentsJson);
        await _sut.LoadQuotesAsync(Dated(QuotesJson), BusinessDate);

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

        // A hand-typed bid in a month the feed does NOT publish. It used to sit in the cell the feed
        // targets, back when a manual value blocked the feed outright; that is now a takeover and has
        // its own test. What matters here is that the feed leaves cells that are none of its business
        // alone.
        _context.BidSheetLocationBids.Add(new BidSheetLocationBid
        {
            LocationId = siouxLocation.Id,
            CommodityCode = "IT_CORN",
            CropYear = 2027,
            Month = 3,
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
            .Where(b => b.LocationId == gpcLocation.Id && b.Month > 0)
            .ToListAsync();
        var gpcDecember = Assert.Single(gpcBids);
        Assert.Equal("4.53", gpcDecember.Bid);
        Assert.Equal(BidSources.Barchart, gpcDecember.Source);
        Assert.Equal("ZCPZ27L-990201-15194.CM", gpcDecember.BarchartSymbol);
        Assert.NotNull(gpcDecember.QuoteAsOf);
        Assert.Equal(2027, gpcDecember.CropYear);
        Assert.Equal(12, gpcDecember.Month);

        // The manual bid is untouched: the feed publishes nothing for March, so it is not its cell.
        // Scoped to that month, because Sioux now also carries the December cell the feed does own.
        var manual = await _context.BidSheetLocationBids.AsNoTracking()
            .SingleAsync(b => b.LocationId == siouxLocation.Id && b.Month == 3);
        Assert.Equal("9.99", manual.Bid);
        Assert.Equal(BidSources.Manual, manual.Source);
        Assert.Null(manual.QuoteAsOf);

        // Re-running changes nothing: no duplicate rows, no ModifiedAt churn.
        // Three: GPC's fed December, Sioux's fed December, and Sioux's untouched manual March. (GPC's
        // October-to-December Variant bid covers no other month because its commodity is unmapped.)
        await _sut.ApplyBidsToBidSheetAsync(null, "bidCash", "barchart-feed");
        Assert.Equal(3, await _context.BidSheetLocationBids
            .CountAsync(b => b.LocationId == gpcLocation.Id || b.LocationId == siouxLocation.Id));
    }

    [Fact]
    public async Task ApplyBids_PrunesItsOwnRowsWhenAMappingIsSwitchedOff_ButLeavesManualBidsStanding()
    {
        if (!Enabled) return;

        await _sut.LoadInstrumentsAsync(InstrumentsJson);
        await _sut.LoadQuotesAsync(Dated(QuotesJson), BusinessDate);

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
            .SingleAsync(b => b.LocationId == gpcLocation.Id && b.Month > 0);
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
                "tradeTimestamp": "REPLACE_FRESH", "mode": "i", "unitCode": "4", "code": 200 },
              { "symbol": "ZCPZ27-990202-6916.CM", "lastPrice": "3.51",
                "tradeTimestamp": "REPLACE_STALE", "mode": "i", "unitCode": "4", "code": 200 },
              { "symbol": "ZCPZ27-990203-17523.CM", "lastPrice": "0.0025",
                "tradeTimestamp": "REPLACE_FRESH", "mode": "i", "unitCode": "4", "code": 200 }
            ] }
            """
            .Replace("REPLACE_FRESH", HoursAgo(2))
            .Replace("REPLACE_STALE", DaysAgo(262));

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

        var gpcCells = await _context.BidSheetLocationBids.Where(b => b.LocationId == gpc.Id && b.Month > 0).ToListAsync();
        var siouxCells = await _context.BidSheetLocationBids.Where(b => b.LocationId == sioux.Id && b.Month > 0).ToListAsync();
        var thirdCells = await _context.BidSheetLocationBids.Where(b => b.LocationId == third.Id && b.Month > 0).ToListAsync();

        // The fresh, plausible price publishes -- and the sentinel does not win its cell despite being
        // the wider delivery window, which is what the ranking would otherwise have preferred.
        // Every quote here is mode i, so each block below is the price bound or the age rule doing the
        // work. Nothing depends on the vendor's mode flag any more.
        Assert.Equal("4.47", Assert.Single(gpcCells).Bid);
        // A 262-day-old quote is not published at all.
        Assert.Empty(siouxCells);
        // Neither is a no-bid placeholder.
        Assert.Empty(thirdCells);
    }

    // Users may fill a cell the vendor does not cover -- that is the point of a feed-linked location
    // still accepting manual bids. When the elevator then publishes that month, with a quote that is
    // current and newer than the user's edit, the vendor's number is the better one and takes the cell
    // over. The first rule left the manual value in place for good, which meant a bid typed into an
    // empty cell silently masked the feed forever; the second took any manual cell the feed had a
    // winner for, which handed frozen vendor prices back over corrections (see newest wins, below).
    [Fact]
    public async Task ApplyBids_TakesOverAManualCellOnceTheFeedPublishesIt()
    {
        if (!Enabled) return;

        var location = await SeedContractMonthCatalogAsync();

        // A user got there first, in the exact cell the feed is about to fill.
        _context.BidSheetLocationBids.Add(new BidSheetLocationBid
        {
            LocationId = location.Id,
            CommodityCode = "IT_FLEX",
            CropYear = 2027,
            Month = 12,
            Bid = "9.99",
            Source = BidSources.Manual,
            CreatedBy = "integration-test",
            // Typed two days ago; the fixture's quote is a day old, so the elevator spoke last.
            CreatedAt = DateTime.UtcNow.AddDays(-2)
        });
        await _context.SaveChangesAsync();

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        var cell = await _context.BidSheetLocationBids.AsNoTracking()
            .SingleAsync(b => b.LocationId == location.Id && b.CommodityCode == "IT_FLEX" && b.Month == 12);
        Assert.Equal("4.47", cell.Bid);
        // Ownership transfers with the value. The user can override again -- fed cells are editable --
        // and the feed takes it back the next time the elevator posts something newer.
        Assert.Equal(BidSources.Barchart, cell.Source);
        Assert.Equal("ZCPZ27-990001-990010.CM", cell.BarchartSymbol);
    }

    // Takeover is total, and that is a decision rather than an oversight: when the vendor publishes only
    // one side of a cell it had not previously owned, the other side is blanked instead of keeping a
    // value from somewhere else -- including a basis the user had typed there. Pinned here because the
    // SQL looks like a missing ISNULL next to the cash side, which coalesces (only because Bid is NOT
    // NULL, where blank and NULL mean the same thing).
    //
    // The catalog fixture publishes cash only, so this is that case: 1 window in 39,096 on the live
    // feed carries one side without the other.
    [Fact]
    public async Task ApplyBids_TakingOverAManualCellClearsABasisTheFeedDoesNotPublish()
    {
        if (!Enabled) return;

        var location = await SeedContractMonthCatalogAsync();

        // The user quoted this cell on basis -- which is how manual bids are normally entered.
        _context.BidSheetLocationBids.Add(new BidSheetLocationBid
        {
            LocationId = location.Id,
            CommodityCode = "IT_FLEX",
            CropYear = 2027,
            Month = 12,
            Bid = string.Empty,
            BasisBid = "-40Z",
            Source = BidSources.Manual,
            CreatedBy = "integration-test",
            CreatedAt = DateTime.UtcNow.AddDays(-2)     // older than the fixture's day-old quote
        });
        await _context.SaveChangesAsync();

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        var cell = await _context.BidSheetLocationBids.AsNoTracking()
            .SingleAsync(b => b.LocationId == location.Id && b.CommodityCode == "IT_FLEX" && b.Month == 12);
        Assert.Equal("4.47", cell.Bid);
        Assert.Equal(BidSources.Barchart, cell.Source);
        // Deliberate: the cell is wholly the vendor's now, and the vendor publishes no basis here.
        Assert.Null(cell.BasisBid);
    }

    // The other half of the same rule: a manual cell the feed has NO winner for is left alone. Only a
    // cell the vendor actually publishes gets taken over.
    [Fact]
    public async Task ApplyBids_LeavesAManualCellTheFeedDoesNotPublish()
    {
        if (!Enabled) return;

        var location = await SeedContractMonthCatalogAsync();

        // A month the fixture's instruments do not cover.
        _context.BidSheetLocationBids.Add(new BidSheetLocationBid
        {
            LocationId = location.Id,
            CommodityCode = "IT_FLEX",
            CropYear = 2027,
            Month = 3,
            Bid = "9.99",
            Source = BidSources.Manual,
            CreatedBy = "integration-test",
            CreatedAt = DateTime.UtcNow
        });
        await _context.SaveChangesAsync();

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        var cell = await _context.BidSheetLocationBids.AsNoTracking()
            .SingleAsync(b => b.LocationId == location.Id && b.CommodityCode == "IT_FLEX" && b.Month == 3);
        Assert.Equal("9.99", cell.Bid);
        Assert.Equal(BidSources.Manual, cell.Source);
    }

    // One vendor bid in five opens its delivery window before its contract month (Cargill East St. Louis's
    // "Nov 26" corn delivers from 1 October). Keying cells off the contract month alone left those months
    // blank, as if the elevator would not take the grain -- it will, at the contract's price. So every
    // month inside the window gets the bid, marked with the contract it came from, while the contract
    // month itself is the elevator's own bid and carries no marker.
    [Fact]
    public async Task ApplyBids_FillsTheMonthsAWindowCovers_MarkedWithTheCoveringContract()
    {
        if (!Enabled) return;

        var location = await SeedContractMonthCatalogAsync();

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        // ZCPZ27 is the December contract delivering 1 Oct - 31 Dec: December is its own; October and
        // November are covered by it.
        var flex = await _context.BidSheetLocationBids.AsNoTracking()
            .Where(b => b.LocationId == location.Id && b.CommodityCode == "IT_FLEX")
            .OrderBy(b => b.Month)
            .ToListAsync();
        Assert.Equal([10, 11, 12], flex.Select(b => b.Month).ToArray());
        Assert.All(flex, b =>
        {
            Assert.Equal(2027, b.CropYear);
            Assert.Equal("4.47", b.Bid);
            Assert.Equal("ZCPZ27-990001-990010.CM", b.BarchartSymbol);
            Assert.Equal(BidSources.Barchart, b.Source);
        });
        Assert.Equal((2027, 12), (flex[0].CoveredByCropYear, flex[0].CoveredByMonth));
        Assert.Equal((2027, 12), (flex[1].CoveredByCropYear, flex[1].CoveredByMonth));
        Assert.Null(flex[2].CoveredByCropYear);
        Assert.Null(flex[2].CoveredByMonth);

        // The half-month bids sit inside December, so they cover nothing else -- and there is no Year row.
        var split = await _context.BidSheetLocationBids.AsNoTracking()
            .Where(b => b.LocationId == location.Id && b.CommodityCode == "IT_SPLIT")
            .Select(b => b.Month)
            .ToListAsync();
        Assert.Equal([12], split);
        Assert.False(await _context.BidSheetLocationBids.AnyAsync(b => b.LocationId == location.Id && b.Month == 0));
    }

    // A month whose delivery window has closed keeps its cells for good. They used to be pruned the day
    // the window elapsed -- the sheet was "today's bids" and tidied up behind itself -- so the record of
    // what a month paid vanished exactly when someone might want to look back at it. Pruning still
    // applies to the current month and later, which is what keeps a rolled-off contract from lingering.
    [Fact]
    public async Task ApplyBids_LeavesAPastMonthsCellsAlone_ButStillPrunesLiveOnes()
    {
        if (!Enabled) return;

        var location = await SeedContractMonthCatalogAsync();
        var lastMonth = DateTime.UtcNow.AddMonths(-1);
        var nextMonth = DateTime.UtcNow.AddMonths(1);

        // Two feed-owned cells the bridge will find no winner for: one behind us, one ahead.
        _context.BidSheetLocationBids.AddRange(
            new BidSheetLocationBid
            {
                LocationId = location.Id,
                CommodityCode = "IT_FLEX",
                CropYear = lastMonth.Year,
                Month = lastMonth.Month,
                Bid = "3.11",
                Source = BidSources.Barchart,
                CreatedBy = "integration-test",
                CreatedAt = DateTime.UtcNow,
            },
            new BidSheetLocationBid
            {
                LocationId = location.Id,
                CommodityCode = "IT_FLEX",
                CropYear = nextMonth.Year,
                Month = nextMonth.Month,
                Bid = "3.22",
                Source = BidSources.Barchart,
                CreatedBy = "integration-test",
                CreatedAt = DateTime.UtcNow,
            });
        await _context.SaveChangesAsync();
        _context.ChangeTracker.Clear();

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        var past = await _context.BidSheetLocationBids.AsNoTracking().SingleOrDefaultAsync(
            b => b.LocationId == location.Id && b.CropYear == lastMonth.Year && b.Month == lastMonth.Month);
        Assert.NotNull(past);
        Assert.Equal("3.11", past!.Bid);   // frozen exactly as it last published

        var live = await _context.BidSheetLocationBids.AsNoTracking().SingleOrDefaultAsync(
            b => b.LocationId == location.Id && b.CropYear == nextMonth.Year && b.Month == nextMonth.Month);
        Assert.Null(live);                 // no winner, still a live month, so it goes
    }

    // The elevator's own bid for a month beats a covering one, so a covered month that later gets its
    // own contract switches to it and drops the marker.
    [Fact]
    public async Task ApplyBids_PrefersTheMonthsOwnBidOverACoveringOne()
    {
        if (!Enabled) return;

        var location = await SeedContractMonthCatalogAsync();
        // A November contract of its own, priced differently from the covering December bid.
        await _sut.LoadInstrumentsAsync("""
            { "status": { "code": 200 }, "results": [
              { "symbol": "ZCPX27-990001-990010.CM", "symbolDescription": "IT Contract Month Elevator Corn (IT Flexible) Nov 27 Cash",
                "elevator": "IT Contract Month Elevator", "commodity": "Corn (IT Flexible)", "underlyingFuture": "ZCZ27",
                "deliveryStart": "2027-11-01T00:00:00-05:00", "deliveryEnd": "2027-12-01T00:00:00-05:00",
                "location": "IT-CONTRACT-MONTH", "facilityType": "Country Elevator", "address": "1 Test Road",
                "city": "Testville", "state": "IA", "zipCode": "50001" }
            ] }
            """);
        await _sut.LoadQuotesAsync("""
            { "status": { "code": 200 }, "results": [
              { "symbol": "ZCPX27-990001-990010.CM", "lastPrice": "4.39",
                "tradeTimestamp": "STAMP_1D", "mode": "i", "unitCode": "4", "code": 200 }
            ] }
            """.Replace("STAMP_1D", DaysAgo(1)), BusinessDate);

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        var november = await _context.BidSheetLocationBids.AsNoTracking()
            .SingleAsync(b => b.LocationId == location.Id && b.CommodityCode == "IT_FLEX" && b.Month == 11);
        Assert.Equal("4.39", november.Bid);
        Assert.Equal("ZCPX27-990001-990010.CM", november.BarchartSymbol);
        Assert.Null(november.CoveredByMonth);

        // October is still only reachable through December's window.
        var october = await _context.BidSheetLocationBids.AsNoTracking()
            .SingleAsync(b => b.LocationId == location.Id && b.CommodityCode == "IT_FLEX" && b.Month == 10);
        Assert.Equal("4.47", october.Bid);
        Assert.Equal(12, october.CoveredByMonth);
    }

    // QuoteAsOf is the vendor's re-post stamp: on the live feed 240 of 478 bids whose price had NOT moved
    // day over day still carried a fresh stamp, which made "moved in the last 24h" light up nearly every
    // pin. CashChangedAt is set only when the stored value actually differs -- never on first insert, and
    // never on a re-post of the same number.
    [Fact]
    public async Task ApplyBids_StampsCashChangedAtOnlyWhenThePriceActuallyMoves()
    {
        if (!Enabled) return;

        var location = await SeedContractMonthCatalogAsync();
        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        var fresh = await December(location.Id);
        Assert.Null(fresh.CashChangedAt);              // just appeared: nothing to have moved from

        // Same price, newer stamp -- a re-post. QuoteAsOf moves, CashChangedAt must not.
        await _sut.LoadQuotesAsync(Quote("4.47", HoursAgo(12)), BusinessDate.AddDays(1));
        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");
        var reposted = await December(location.Id);
        Assert.NotEqual(fresh.QuoteAsOf, reposted.QuoteAsOf);
        Assert.Null(reposted.CashChangedAt);

        // A different price: this is a move.
        await _sut.LoadQuotesAsync(Quote("4.52", HoursAgo(6)), BusinessDate.AddDays(2));
        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");
        var moved = await December(location.Id);
        Assert.Equal("4.52", moved.Bid);
        Assert.NotNull(moved.CashChangedAt);
        Assert.InRange(moved.CashChangedAt!.Value, DateTime.UtcNow.AddMinutes(-5), DateTime.UtcNow.AddMinutes(1));

        static string Quote(string price, string stamp) => $$"""
            { "status": { "code": 200 }, "results": [
              { "symbol": "ZCPZ27-990001-990010.CM", "lastPrice": "{{price}}",
                "tradeTimestamp": "{{stamp}}", "mode": "i", "unitCode": "4", "code": 200 }
            ] }
            """;
    }

    private Task<BidSheetLocationBid> December(int locationId) =>
        _context.BidSheetLocationBids.AsNoTracking()
            .SingleAsync(b => b.LocationId == locationId && b.CommodityCode == "IT_FLEX" && b.Month == 12);

    // Mode reports how BarChart delivered the quote -- real-time, delayed, or end-of-day -- not whether
    // the bid is any good. We used to block mode d believing it meant a dead record, which suppressed
    // 1,126 perfectly good quotes under 90 days old. A recent end-of-day price must publish.
    [Fact]
    public async Task ApplyBids_PublishesAnEndOfDayQuote_BecauseModeIsNotAValidityFlag()
    {
        if (!Enabled) return;

        await _sut.LoadInstrumentsAsync(ContractMonthInstrumentsJson);

        var endOfDay = """
            { "status": { "code": 200 }, "results": [
              { "symbol": "ZCPZ27-990001-990010.CM", "lastPrice": "4.47",
                "tradeTimestamp": "REPLACE", "mode": "d", "flag": "s", "unitCode": "4", "code": 200 }
            ] }
            """.Replace("REPLACE", DaysAgo(3));
        await _sut.LoadQuotesAsync(endOfDay, BusinessDate);

        _context.BarchartCommodityMaps.Add(new BarchartCommodityMap
        {
            BarchartCommodity = "Corn (IT Flexible)",
            CommodityCode = "IT_FLEX",
            CreatedBy = "integration-test"
        });
        var location = NewLinkedLocation("__IT End Of Day", "990001");
        _context.BidSheetLocations.Add(location);
        await _context.SaveChangesAsync();

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        var cell = await _context.BidSheetLocationBids.AsNoTracking()
            .SingleAsync(b => b.LocationId == location.Id && b.CommodityCode == "IT_FLEX" && b.Month == 12);
        Assert.Equal("4.47", cell.Bid);
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
            "tradeTimestamp": "STAMP_1D", "mode": "i", "unitCode": "4", "code": 200 },
          { "symbol": "ZCPZ27F-990001-990011.CM", "lastPrice": "4.41",
            "tradeTimestamp": "STAMP_1D", "mode": "i", "unitCode": "4", "code": 200 },
          { "symbol": "ZCPZ27L-990001-990011.CM", "lastPrice": "4.53",
            "tradeTimestamp": "STAMP_1D", "mode": "i", "unitCode": "4", "code": 200 }
        ] }
        """;

    private async Task<BidSheetLocation> SeedContractMonthCatalogAsync()
    {
        await _sut.LoadInstrumentsAsync(ContractMonthInstrumentsJson);
        await _sut.LoadQuotesAsync(Dated(ContractMonthQuotesJson), BusinessDate);

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
            .SingleAsync(b => b.LocationId == location.Id && b.CommodityCode == "IT_FLEX" && b.Month == 12);

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
            .SingleAsync(b => b.LocationId == location.Id && b.CommodityCode == "IT_SPLIT" && b.Month == 12);

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
            """.Replace("REPLACE_OLD", DaysAgo(30));
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

        var cells = await _context.BidSheetLocationBids.Where(b => b.LocationId == sioux.Id && b.Month > 0).ToListAsync();
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

        var fresh = HoursAgo(1);
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

        var cell = await _context.BidSheetLocationBids.SingleAsync(b => b.LocationId == loc.Id && b.Month > 0);
        Assert.Equal("4.41", cell.Bid);
        // Minus sign preserved, and no trailing zeros -- an originator reads 30 under, not -30.00.
        Assert.Equal("-30", cell.BasisBid);
        Assert.Equal(BidSources.Barchart, cell.Source);
    }

    // A basis-only winner is held to the same rule as cash: this quote is an hour older than the edit,
    // so it neither attaches its basis nor takes the cell. The feed cannot half-write a row a user
    // owns, and cannot take it with a post older than the user's.
    [Fact]
    public async Task ApplyBids_DoesNotAttachBasisToAManualBid()
    {
        if (!Enabled) return;

        await _sut.LoadInstrumentsAsync(InstrumentsJson);
        var fresh = HoursAgo(1);
        await _sut.LoadQuotesAsync("""
            { "status": { "code": 200 }, "results": [
              { "symbol": "ZCBZ27-990202-6916.CM", "lastPrice": "-30",
                "tradeTimestamp": "REPLACE", "mode": "i", "unitCode": "4", "code": 200 }
            ] }
            """.Replace("REPLACE", fresh), BusinessDate);

        _context.BarchartCommodityMaps.Add(new BarchartCommodityMap
        {
            BarchartCommodity = "Corn (IT Standard)",
            CommodityCode = "IT_CORN",
            CreatedBy = "integration-test"
        });
        var loc = NewLinkedLocation("__IT Basis Manual", "990202");
        _context.BidSheetLocations.Add(loc);
        await _context.SaveChangesAsync();

        _context.BidSheetLocationBids.Add(new BidSheetLocationBid
        {
            LocationId = loc.Id,
            CommodityCode = "IT_CORN",
            CropYear = 2027,
            Month = 12,
            Bid = "9.99",
            Source = BidSources.Manual,
            CreatedBy = "integration-test",
            CreatedAt = DateTime.UtcNow
        });
        await _context.SaveChangesAsync();

        await _sut.ApplyBidsToBidSheetAsync(null, "bidCash", "barchart-feed");

        var cell = await _context.BidSheetLocationBids.SingleAsync(b => b.LocationId == loc.Id && b.Month > 0);
        Assert.Equal("9.99", cell.Bid);
        Assert.Null(cell.BasisBid);
        Assert.Equal(BidSources.Manual, cell.Source);
    }
    // ── newest wins ──────────────────────────────────────────────────────────────────────────────
    // BarChart keeps serving the LAST price for a period an elevator stopped posting (Goodland's
    // October corn sat frozen for two weeks while December moved nightly, 2026-10), so a user who
    // corrects a frozen cell must not lose the correction to the same frozen price the next morning.
    // The feed takes a hand-typed cell back only with a quote that is both current (inside
    // staleAfterDays) and stamped after the edit. The tests seed the contract-month catalog, whose
    // December quote is a day old, and a hand-typed December cell at a chosen edit time.

    private async Task SeedManualDecemberAsync(
        int locationId, DateTime createdAt, DateTime? modifiedAt = null, string commodityCode = "IT_FLEX")
    {
        _context.BidSheetLocationBids.Add(new BidSheetLocationBid
        {
            LocationId = locationId,
            CommodityCode = commodityCode,
            CropYear = 2027,
            Month = 12,
            Bid = "9.99",
            Source = BidSources.Manual,
            CreatedBy = "integration-test",
            CreatedAt = createdAt,
            ModifiedBy = modifiedAt is null ? null : "integration-test",
            ModifiedAt = modifiedAt
        });
        await _context.SaveChangesAsync();
    }

    /// <summary>Re-quotes the contract-month fixture's December cash at a chosen stamp.</summary>
    private static string DecemberQuote(string price, string stamp) => $$"""
        { "status": { "code": 200 }, "results": [
          { "symbol": "ZCPZ27-990001-990010.CM", "lastPrice": "{{price}}",
            "tradeTimestamp": "{{stamp}}", "mode": "i", "unitCode": "4", "code": 200 }
        ] }
        """;

    [Fact]
    public async Task ApplyBids_LeavesAManualCellTypedAfterTheFeedsLastPost()
    {
        if (!Enabled) return;

        var location = await SeedContractMonthCatalogAsync();          // quote: a day ago
        await SeedManualDecemberAsync(location.Id, createdAt: DateTime.UtcNow);

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        var cell = await December(location.Id);
        Assert.Equal("9.99", cell.Bid);
        Assert.Equal(BidSources.Manual, cell.Source);
    }

    // Newer than the edit is not enough on its own: a quote the elevator has not touched for a month
    // is the frozen price this rule exists to keep off the sheet.
    [Fact]
    public async Task ApplyBids_NeverTakesAManualCellWithAStaleQuote()
    {
        if (!Enabled) return;

        var location = await SeedContractMonthCatalogAsync();
        await _sut.LoadQuotesAsync(DecemberQuote("4.47", DaysAgo(30)), BusinessDate.AddDays(1));
        await SeedManualDecemberAsync(location.Id, createdAt: DateTime.UtcNow.AddDays(-60));

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        var cell = await December(location.Id);
        Assert.Equal("9.99", cell.Bid);
        Assert.Equal(BidSources.Manual, cell.Source);
    }

    // The edit time is the LAST edit: a cell created months ago but corrected today was corrected today.
    [Fact]
    public async Task ApplyBids_UsesModifiedAtOverCreatedAtForTheEditTime()
    {
        if (!Enabled) return;

        var location = await SeedContractMonthCatalogAsync();          // quote: a day ago
        await SeedManualDecemberAsync(location.Id, createdAt: DateTime.UtcNow.AddDays(-30), modifiedAt: DateTime.UtcNow);

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        Assert.Equal(BidSources.Manual, (await December(location.Id)).Source);
    }

    // A quote with no stamp can prove neither currency nor order, so it never displaces a person --
    // though it still publishes to a cell the feed already owns (untimestamped quotes are let through
    // on purpose).
    [Fact]
    public async Task ApplyBids_NeverTakesAManualCellWithAnUntimestampedQuote()
    {
        if (!Enabled) return;

        var location = await SeedContractMonthCatalogAsync();
        await _sut.LoadQuotesAsync("""
            { "status": { "code": 200 }, "results": [
              { "symbol": "ZCPZ27-990001-990010.CM", "lastPrice": "4.47", "mode": "i", "unitCode": "4", "code": 200 }
            ] }
            """, BusinessDate.AddDays(1));
        await SeedManualDecemberAsync(location.Id, createdAt: DateTime.UtcNow.AddDays(-60));

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        Assert.Equal(BidSources.Manual, (await December(location.Id)).Source);
    }

    // Staleness is a trust rule, not a publish rule: a cell the feed already owns keeps refreshing from
    // a quote past the stale window, so the sheet can show the date the elevator went quiet.
    [Fact]
    public async Task ApplyBids_StillRefreshesAFedCellFromAStaleQuote()
    {
        if (!Enabled) return;

        var location = await SeedContractMonthCatalogAsync();
        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");
        await _sut.LoadQuotesAsync(DecemberQuote("4.52", DaysAgo(30)), BusinessDate.AddDays(1));

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        var cell = await December(location.Id);
        Assert.Equal("4.52", cell.Bid);
        Assert.Equal(BidSources.Barchart, cell.Source);
        Assert.InRange(cell.QuoteAsOf!.Value, DateTime.UtcNow.AddDays(-30).AddMinutes(-5), DateTime.UtcNow.AddDays(-30).AddMinutes(5));
    }

    // The two windows side by side: inside the 90-day publish window a frozen cell is kept, with the
    // stamp the sheet prints under the blank; past it the cell is pruned like any row without a winner.
    [Fact]
    public async Task ApplyBids_KeepsAStaleFedCellInsideThePublishWindowAndPrunesItPastIt()
    {
        if (!Enabled) return;

        var location = await SeedContractMonthCatalogAsync();
        await _sut.LoadQuotesAsync(DecemberQuote("4.47", DaysAgo(30)), BusinessDate.AddDays(1));
        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");
        Assert.Equal(BidSources.Barchart, (await December(location.Id)).Source);

        await _sut.LoadQuotesAsync(DecemberQuote("4.47", DaysAgo(100)), BusinessDate.AddDays(2));
        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        Assert.False(await _context.BidSheetLocationBids.AsNoTracking()
            .AnyAsync(b => b.LocationId == location.Id && b.CommodityCode == "IT_FLEX" && b.Month == 12));
    }

    // The window is the environment's (Barchart:StaleAfterDays), threaded in by every caller.
    [Fact]
    public async Task ApplyBids_TakeoverHonoursThePassedStaleWindow()
    {
        if (!Enabled) return;

        var location = await SeedContractMonthCatalogAsync();
        await _sut.LoadQuotesAsync(DecemberQuote("4.47", DaysAgo(20)), BusinessDate.AddDays(1));
        await SeedManualDecemberAsync(location.Id, createdAt: DateTime.UtcNow.AddDays(-25));

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");
        Assert.Equal(BidSources.Manual, (await December(location.Id)).Source);   // 20 days is past the default 10

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed", staleAfterDays: 30);
        var cell = await December(location.Id);
        Assert.Equal("4.47", cell.Bid);
        Assert.Equal(BidSources.Barchart, cell.Source);
    }

    /// <summary>The Sioux fixture (990202) quoted on cash and basis, each at its own stamp, mapped to IT_CORN.</summary>
    private async Task<BidSheetLocation> SeedSiouxCashAndBasisAsync(string cashStamp, string basisStamp)
    {
        await _sut.LoadInstrumentsAsync(InstrumentsJson);
        await _sut.LoadQuotesAsync($$"""
            { "status": { "code": 200 }, "results": [
              { "symbol": "ZCPZ27-990202-6916.CM", "lastPrice": "4.41",
                "tradeTimestamp": "{{cashStamp}}", "mode": "i", "unitCode": "4", "code": 200 },
              { "symbol": "ZCBZ27-990202-6916.CM", "lastPrice": "-30",
                "tradeTimestamp": "{{basisStamp}}", "mode": "i", "unitCode": "4", "code": 200 }
            ] }
            """, BusinessDate);
        _context.BarchartCommodityMaps.Add(new BarchartCommodityMap
        {
            BarchartCommodity = "Corn (IT Standard)",
            CommodityCode = "IT_CORN",
            CreatedBy = "integration-test"
        });
        var loc = NewLinkedLocation("__IT Sioux Newest Wins", "990202");
        _context.BidSheetLocations.Add(loc);
        await _context.SaveChangesAsync();
        return loc;
    }

    private Task<BidSheetLocationBid> SiouxDecember(int locationId) =>
        _context.BidSheetLocationBids.AsNoTracking().SingleAsync(b => b.LocationId == locationId && b.Month > 0);

    // A takeover rewrites cash and basis together, so the feed's word on the cell is the OLDER of the two
    // stamps: a live basis must not carry a frozen cash price back over a number somebody typed.
    [Fact]
    public async Task ApplyBids_LeavesAManualCellWhenOnlyOneSideOfTheFeedIsFresh()
    {
        if (!Enabled) return;

        var loc = await SeedSiouxCashAndBasisAsync(cashStamp: DaysAgo(20), basisStamp: HoursAgo(1));
        await SeedManualDecemberAsync(loc.Id, createdAt: DateTime.UtcNow.AddDays(-1), commodityCode: "IT_CORN");

        await _sut.ApplyBidsToBidSheetAsync(loc.Id, "bidCash", "barchart-feed");

        var cell = await SiouxDecember(loc.Id);
        Assert.Equal("9.99", cell.Bid);
        Assert.Null(cell.BasisBid);
        Assert.Equal(BidSources.Manual, cell.Source);
    }

    // The positive case, so the rule above cannot pass by never taking anything over.
    [Fact]
    public async Task ApplyBids_TakesOverAManualCellWhenBothSidesAreCurrentAndNewerThanTheEdit()
    {
        if (!Enabled) return;

        var loc = await SeedSiouxCashAndBasisAsync(cashStamp: HoursAgo(2), basisStamp: HoursAgo(1));
        await SeedManualDecemberAsync(loc.Id, createdAt: DateTime.UtcNow.AddDays(-1), commodityCode: "IT_CORN");

        await _sut.ApplyBidsToBidSheetAsync(loc.Id, "bidCash", "barchart-feed");

        var cell = await SiouxDecember(loc.Id);
        Assert.Equal("4.41", cell.Bid);
        Assert.Equal("-30", cell.BasisBid);
        Assert.Equal(BidSources.Barchart, cell.Source);
    }

    // The contract a bid is quoted against is what makes two bids comparable, and it is NOT always the
    // delivery month: Kansas City wheat delivering in January trades against the March board. The Year
    // cell names it, so it has to reach the cell -- and reach the Year row, which is a month standing
    // in for a year and would otherwise say nothing about which board it is priced off.
    [Fact]
    public async Task ApplyBids_CarriesTheContractTheBidIsQuotedAgainstOntoTheCell()
    {
        if (!Enabled) return;

        var location = await SeedContractMonthCatalogAsync();

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        var december = await _context.BidSheetLocationBids.AsNoTracking()
            .SingleAsync(b => b.LocationId == location.Id && b.CommodityCode == "IT_SPLIT" && b.Month == 12);

        Assert.Equal("ZCZ27", december.UnderlyingFuture);
    }

    private const string ShortYearInstrumentsJson = """
        { "status": { "code": 200 }, "results": [
          { "symbol": "ZCPZ27-990003-990030.CM", "symbolDescription": "IT Short Year Elevator Corn (IT Short) Dec 27 Cash",
            "elevator": "IT Short Year Elevator", "commodity": "Corn (IT Short)", "underlyingFuture": "ZCZ7",
            "deliveryStart": "2027-10-01T00:00:00-05:00", "deliveryEnd": "2027-12-31T00:00:00-05:00",
            "location": "IT-SHORT-YEAR", "facilityType": "Country Elevator", "address": "1 Test Road",
            "city": "Testville", "state": "IA", "zipCode": "50001" }
        ] }
        """;

    private const string ShortYearQuotesJson = """
        { "status": { "code": 200 }, "results": [
          { "symbol": "ZCPZ27-990003-990030.CM", "lastPrice": "4.61",
            "tradeTimestamp": "STAMP_1D", "mode": "i", "unitCode": "4", "code": 200 }
        ] }
        """;

    // BarChart sends two year forms for the same contract -- ZCZ26 and the one-digit ZCZ6 -- and both
    // are live in the catalog (722 of 68,000 active instruments use the short one). Two spellings of
    // the same December on one sheet reads as two different contracts, which is exactly the confusion
    // naming the contract is meant to remove, so the short form is expanded on the way in.
    //
    // The digit names the first year at or after delivery that ends in it. That rule reproduces every
    // short-form row in the live catalog, including ZSF7 on a window starting in December 2026, where
    // the contract is January 2027 rather than any 2026 month.
    [Fact]
    public async Task ApplyBids_ExpandsAOneDigitContractYearAgainstTheDeliveryYear()
    {
        if (!Enabled) return;

        await _sut.LoadInstrumentsAsync(ShortYearInstrumentsJson);
        await _sut.LoadQuotesAsync(Dated(ShortYearQuotesJson), BusinessDate);
        _context.BarchartCommodityMaps.Add(new BarchartCommodityMap
        {
            BarchartCommodity = "Corn (IT Short)",
            CommodityCode = "IT_SHORT",
            CommodityName = "Corn (IT Short)",
            CommodityCategory = "Grains",
            CreatedBy = "integration-test"
        });
        var location = NewLinkedLocation("__IT Short Year", "990003");
        _context.BidSheetLocations.Add(location);
        await _context.SaveChangesAsync();

        await _sut.ApplyBidsToBidSheetAsync(location.Id, "bidCash", "barchart-feed");

        var cell = await _context.BidSheetLocationBids.AsNoTracking()
            .SingleAsync(b => b.LocationId == location.Id && b.CommodityCode == "IT_SHORT" && b.Month == 12);

        // The vendor said ZCZ7 against a window in 2027.
        Assert.Equal("ZCZ27", cell.UnderlyingFuture);
    }
}
