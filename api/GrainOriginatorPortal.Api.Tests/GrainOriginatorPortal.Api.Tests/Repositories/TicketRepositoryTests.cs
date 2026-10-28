// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Direct coverage of <see cref="TicketRepository"/> against InMemory ODS + app contexts: the
/// Spot Loads producer-scope resolution (snapshot ∪ contract-derived codes), the customer-storage
/// gate that drops priced-out C-prefix tickets, the MbpLocationSynonym location fill, and the
/// empty-scope / missing-customer short-circuits that every public read guards with.
/// </summary>
/// <remarks>
/// Deliberately NOT tested here: the ticket loads themselves. <c>GetAsync</c>, <c>GetTodaysAsync</c>,
/// <c>GetByCustomerAsync</c>, <c>GetUnappliedByCustomerAsync</c> and <c>GetAppliedByContractAsync</c>
/// all reach <c>FromSqlInterpolated</c> over <c>base.vw_CurrentTickets</c> (STRING_SPLIT + UNION ALL)
/// or call <c>SetCommandTimeout</c>, neither of which the InMemory provider can run, and
/// <c>GetActiveStorageCommoditiesAsync</c> is a <c>SqlQueryRaw</c> over <c>ctrm.vw_GNTA39D1</c>.
/// <c>PopulateElevatorLocations</c> is internal (no InternalsVisibleTo) and only reachable through
/// those same loads. All of that needs the real-SQL harness; what is covered below is everything
/// that sits in front of or behind that SQL.
/// </remarks>
public class TicketRepositoryTests
{
    private static (TicketRepository Sut, OriginationDbContext Ods, ApplicationDbContext App) Build()
    {
        var ods = new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"tickets-ods-{Guid.NewGuid()}").Options);
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"tickets-app-{Guid.NewGuid()}").Options);

        return (new TicketRepository(ods, app, new Mock<ILogger<TicketRepository>>().Object), ods, app);
    }

    private static Customer Producer(long id, string? scoularId, bool isActive = true) => new()
    {
        Id = id, ScoularId = scoularId, Name = $"Farm {id}", IsActive = isActive
    };

    private static CustomerTradeUnit Membership(int id, long customerId, string tradeUnit, bool isActive = true) => new()
    {
        Id = id, CustomerId = customerId, TradeUnit = tradeUnit, IsActive = isActive
    };

    private static Contract PurchaseContract(long id, string customerCode, string tradeUnit,
        string prefixType = "P", bool isActive = true) => new()
    {
        Id = id, SourceContractId = $"P{id:D8}", ContractNumber = $"P{id:D8}", CtrmCustomerId = customerCode,
        TradeUnit = tradeUnit, ContractPrefixType = prefixType, IsActive = isActive
    };

    private static Ticket StorageTicket(long id, string? customerCode, string? productCode, string? contractNumber = "C0001") => new()
    {
        Id = id, TicketNumber = id.ToString(), CustomerCode = customerCode, ProductCode = productCode,
        CtrmContractNumber = contractNumber, TicketType = "U"
    };

    private static Dictionary<string, HashSet<string>> Storage(params (string Customer, string Commodity)[] rows)
    {
        var result = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var (customer, commodity) in rows)
        {
            if (!result.TryGetValue(customer, out var set))
                result[customer] = set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            set.Add(commodity);
        }
        return result;
    }

    // =========================================================================
    // ResolveSpotLoadProducerCodesAsync
    // =========================================================================

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(true)]   // null trade units
    [InlineData(false)]  // empty list
    public async Task ResolveSpotLoadProducerCodes_NoTradeUnits_ReturnsEveryActiveProducerWithACode(bool useNull)
    {
        var (sut, _, app) = Build();
        app.Customers.AddRange(
            Producer(1, "A1"),
            Producer(2, "B2"),
            Producer(3, "C3", isActive: false),   // inactive → excluded
            Producer(4, null));                   // no ScoularId → excluded
        await app.SaveChangesAsync();

        var codes = await sut.ResolveSpotLoadProducerCodesAsync(useNull ? null : [], CancellationToken.None);

        Assert.Equal(new[] { "A1", "B2" }, codes.OrderBy(c => c));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ResolveSpotLoadProducerCodes_WithTradeUnits_UnionsSnapshotAndContractDerivedCodes()
    {
        var (sut, ods, app) = Build();
        app.Customers.AddRange(
            Producer(1, "SNAP1"),                 // in TU via snapshot
            Producer(2, "OTHER"),                 // in a different TU → excluded
            Producer(3, "INACT", isActive: false),// inactive even though in TU → excluded
            Producer(4, "GONE"));                 // membership row deactivated → excluded
        app.CustomerTradeUnits.AddRange(
            Membership(1, 1, "4056"),
            Membership(2, 2, "9999"),
            Membership(3, 3, "4056"),
            Membership(4, 4, "4056", isActive: false));
        await app.SaveChangesAsync();

        ods.Contracts.AddRange(
            PurchaseContract(10, "CTRCT1", "4056"),                     // contract-derived, no snapshot row → included
            PurchaseContract(11, "CTRCT1", "4056"),                     // duplicate code → de-duplicated
            PurchaseContract(12, "SALE", "4056", prefixType: "S"),      // sale contract → excluded
            PurchaseContract(13, "DEAD", "4056", isActive: false),      // inactive contract → excluded
            PurchaseContract(14, "ELSEWHERE", "9999"),                  // other TU → excluded
            PurchaseContract(15, "SNAP1", "4056"));                     // same code as the snapshot → one entry
        await ods.SaveChangesAsync();

        var codes = await sut.ResolveSpotLoadProducerCodesAsync(["4056"], CancellationToken.None);

        Assert.Equal(new[] { "CTRCT1", "SNAP1" }, codes.OrderBy(c => c));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ResolveSpotLoadProducerCodes_WithTradeUnits_IgnoresContractsWithoutACustomerCode()
    {
        var (sut, ods, _) = Build();
        ods.Contracts.Add(new Contract
        {
            Id = 1, SourceContractId = "P1", ContractNumber = "P1", CtrmCustomerId = null,
            TradeUnit = "4056", ContractPrefixType = "P", IsActive = true
        });
        await ods.SaveChangesAsync();

        var codes = await sut.ResolveSpotLoadProducerCodesAsync(["4056"], CancellationToken.None);

        Assert.Empty(codes);
    }

    // =========================================================================
    // GateCustomerStorageTickets
    // =========================================================================

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("P0001")]   // applied purchase ticket
    [InlineData("U0001")]   // unapplied
    [InlineData("L0001")]   // loadout
    [InlineData(null)]      // no contract number at all
    [InlineData("")]
    public void GateCustomerStorageTickets_NonStorageTicketsPassThroughUntouched(string? contractNumber)
    {
        var (sut, _, _) = Build();
        var tickets = new List<Ticket> { StorageTicket(1, "CUST", "CORN", contractNumber) };

        var kept = sut.GateCustomerStorageTickets(tickets, Storage()); // no storage at all

        Assert.Single(kept);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void GateCustomerStorageTickets_KeepsStorageTicketOnlyWhileCommodityIsStillInStorage()
    {
        var (sut, _, _) = Build();
        var tickets = new List<Ticket>
        {
            StorageTicket(1, "CUST", "CORN"),    // still stored → kept
            StorageTicket(2, "CUST", "WHEAT"),   // priced out → dropped
            StorageTicket(3, "OTHER", "CORN"),   // different producer with no storage → dropped
        };

        var kept = sut.GateCustomerStorageTickets(tickets, Storage(("CUST", "CORN")));

        Assert.Equal(new long[] { 1 }, kept.Select(t => t.Id));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void GateCustomerStorageTickets_MatchesLowercasePrefixAndTrimsCodes()
    {
        var (sut, _, _) = Build();
        var tickets = new List<Ticket>
        {
            StorageTicket(1, " CUST ", " CORN ", "c0001"),   // lowercase c, padded codes → still gated and matched
            StorageTicket(2, " CUST ", "MILO", "c0002"),     // gated, not in storage → dropped
        };

        var kept = sut.GateCustomerStorageTickets(tickets, Storage(("CUST", "CORN")));

        Assert.Equal(new long[] { 1 }, kept.Select(t => t.Id));
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(null, "CORN")]
    [InlineData("", "CORN")]
    [InlineData("CUST", null)]
    [InlineData("CUST", "")]
    public void GateCustomerStorageTickets_StorageTicketMissingProducerOrCommodity_IsTreatedAsPricedOut(string? customerCode, string? productCode)
    {
        var (sut, _, _) = Build();
        var tickets = new List<Ticket> { StorageTicket(1, customerCode, productCode) };

        var kept = sut.GateCustomerStorageTickets(tickets, Storage(("CUST", "CORN")));

        Assert.Empty(kept);
    }

    // =========================================================================
    // Short-circuits in front of the raw SQL
    // =========================================================================

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetAsync_NoTradeUnits_NoActiveProducers_ReturnsEmptyWithoutQueryingTickets()
    {
        var (sut, _, app) = Build();
        app.Customers.AddRange(Producer(1, "C1", isActive: false), Producer(2, null));
        await app.SaveChangesAsync();

        var tickets = await sut.GetAsync(null, CancellationToken.None);

        Assert.Empty(tickets);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(true)]   // unfiltered: no active producers at all
    [InlineData(false)]  // filtered: trade unit with no producers
    public async Task GetTodaysAsync_NoProducersInScope_ReturnsEmpty(bool unfiltered)
    {
        var (sut, _, app) = Build();
        // Unfiltered: the only producer is inactive, so the branch resolves nobody.
        // Filtered: the producer is active but sits in a trade unit the caller did not select.
        app.Customers.Add(Producer(1, "C1", isActive: !unfiltered));
        app.CustomerTradeUnits.Add(Membership(1, 1, "4056"));
        await app.SaveChangesAsync();

        var tickets = await sut.GetTodaysAsync(unfiltered ? null : ["9999"], CancellationToken.None);

        Assert.Empty(tickets);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(99L)]   // customer does not exist
    [InlineData(2L)]    // customer exists but has no ScoularId
    public async Task GetByCustomerAsync_CustomerWithoutCode_ReturnsEmpty(long customerId)
    {
        var (sut, _, app) = Build();
        app.Customers.Add(Producer(2, null));
        await app.SaveChangesAsync();

        var tickets = await sut.GetByCustomerAsync(customerId, scoularId: null, CancellationToken.None);

        Assert.Empty(tickets);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(99L)]
    [InlineData(2L)]
    public async Task GetUnappliedByCustomerAsync_CustomerWithoutCode_ReturnsEmpty(long customerId)
    {
        var (sut, _, app) = Build();
        app.Customers.Add(Producer(2, ""));
        await app.SaveChangesAsync();

        var tickets = await sut.GetUnappliedByCustomerAsync(customerId, scoularId: null, CancellationToken.None);

        Assert.Empty(tickets);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task GetAppliedByContractAsync_BlankContractNumber_ReturnsEmpty(string? sourceContractId)
    {
        var (sut, _, _) = Build();

        var tickets = await sut.GetAppliedByContractAsync(sourceContractId!, CancellationToken.None);

        Assert.Empty(tickets);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByFarmAsync_FarmIsNotInOds_ReturnsEmpty()
    {
        var (sut, _, _) = Build();

        var tickets = await sut.GetByFarmAsync("FARM-1", CancellationToken.None);

        Assert.Empty(tickets);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetActiveStorageCommoditiesAsync_NoCodes_ReturnsEmptyCaseInsensitiveMap()
    {
        var (sut, _, _) = Build();

        var map = await sut.GetActiveStorageCommoditiesAsync([], CancellationToken.None);

        Assert.Empty(map);
        Assert.Same(StringComparer.OrdinalIgnoreCase, map.Comparer);
    }
}
