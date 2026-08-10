// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Covers the ticket bill-of-lading window snapshot.
/// </summary>
/// <remarks>
/// The two rules worth pinning are the server's 366-day range cap — which <c>contracts</c> does not
/// share, so it is easy to assume the windows are interchangeable — and the detail pruning that keeps a
/// split ticket's other parties out of memory.
/// </remarks>
public class CtrmTicketSnapshotTests
{
    private const string KnownProducer = "TATOBIN";

    private sealed class StubClient : ICtrmGraphQlClient
    {
        private readonly Func<int, CtrmPage<CtrmTicketDto>> _pageFactory;

        public StubClient(Func<int, CtrmPage<CtrmTicketDto>> pageFactory) => _pageFactory = pageFactory;

        public bool IsConfigured { get; init; } = true;
        public int Calls { get; private set; }

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            Calls++;
            Assert.DoesNotContain('#', document);

            var response = new CtrmTicketsResponse { Tickets = _pageFactory(Calls - 1) };
            return Task.FromResult(new CtrmReadResult<T>
            {
                Status = CtrmReadStatus.Ok,
                HttpStatus = 200,
                Value = (T)(object)response
            });
        }
    }

    private static IConfiguration Config(string? from = "2026-01-01", string? to = "2026-12-31", int maxPages = 10)
    {
        var values = new Dictionary<string, string?>
        {
            ["Ctrm:TicketPageSize"] = "2",
            ["Ctrm:TicketMaxPages"] = maxPages.ToString(),
            ["Ctrm:TicketSnapshotMinutes"] = "30"
        };
        if (from is not null) values["Ctrm:TicketBlDateFrom"] = from;
        if (to is not null) values["Ctrm:TicketBlDateTo"] = to;

        return new ConfigurationBuilder().AddInMemoryCollection(values).Build();
    }

    private static IServiceScopeFactory ScopeFactory()
    {
        // The name MUST be computed outside the lambda. That delegate runs on every DbContext
        // construction, so generating the Guid inside it gives the seeding context and the snapshot's
        // context two different in-memory databases — the seed then silently vanishes.
        var dbName = $"tickets-app-{Guid.NewGuid()}";

        var services = new ServiceCollection();
        services.AddDbContext<ApplicationDbContext>(o => o.UseInMemoryDatabase(dbName));
        var provider = services.BuildServiceProvider();

        using var scope = provider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        db.Customers.Add(new Customer { ScoularId = KnownProducer, Name = "T-A Tobin", IsActive = true });
        db.SaveChanges();

        return provider.GetRequiredService<IServiceScopeFactory>();
    }

    private static CtrmTicketSnapshot Sut(ICtrmGraphQlClient client, IConfiguration config) =>
        new(client, config, new Mock<ILogger<CtrmTicketSnapshot>>().Object, ScopeFactory());

    private static CtrmPage<CtrmTicketDto> Page(bool hasNext, params CtrmTicketDto[] tickets) => new()
    {
        TotalCount = tickets.Length,
        PageInfo = new CtrmPageInfo { HasNextPage = hasNext },
        Items = tickets.ToList()
    };

    private static CtrmTicketDto Ticket(string number, params string[] detailCustomerCodes) => new()
    {
        TicketPrefix = "T",
        TicketNumber = number,
        TicketSuffix = "",
        TicketBLDate = new DateTime(2026, 3, 1),
        ProductCode = "YC",
        Details = detailCustomerCodes
            .Select((c, i) => new CtrmTicketDetailDto
            {
                CustomerCode = c,
                TicketSequenceNumber = i + 1,
                ContractNumber = "PWW227420",
                CancelFlag = "N"
            })
            .ToList()
    };

    // -------------------------------------------------------------------------
    [Fact]
    public void TheTestHarnessActuallySeedsAProducer()
    {
        // Sanity check on the fixture itself: the snapshot refuses to build when no producer codes are
        // found, so a silently-empty customer table would make every other test here fail for the wrong
        // reason.
        using var scope = ScopeFactory().CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        Assert.Equal(KnownProducer, Assert.Single(db.Customers.ToList()).ScoularId);
    }

    // -------------------------------------------------------------------------
    [Theory]
    // 2025-11-01 -> 2026-12-31 is 425 days: the exact window that works for contracts and is rejected
    // for tickets. Assuming the two are interchangeable is the mistake this guards.
    [InlineData("2025-11-01", "2026-12-31")]
    [InlineData("2025-01-01", "2026-12-31")]
    public async Task WindowsWiderThan366Days_AreRefusedBeforeAnyRequest(string from, string to)
    {
        var client = new StubClient(_ => Page(false, Ticket("1", KnownProducer)));

        var result = await Sut(client, Config(from, to)).GetAsync(CancellationToken.None);

        Assert.Equal(CtrmReadStatus.NotConfigured, result.Status);
        Assert.Contains("366", result.Detail);
        // Caught locally rather than by letting the server reject it.
        Assert.Equal(0, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AWindowExactlyAtTheLimit_IsAccepted()
    {
        var client = new StubClient(_ => Page(false, Ticket("1", KnownProducer)));

        var result = await Sut(client, Config("2026-01-01", "2027-01-02")).GetAsync(CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Ok, result.Status);
        Assert.Equal(1, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task MissingWindow_IsRefusedRatherThanDefaulted()
    {
        var client = new StubClient(_ => Page(false, Ticket("1", KnownProducer)));

        var result = await Sut(client, Config(from: null)).GetAsync(CancellationToken.None);

        Assert.Equal(CtrmReadStatus.NotConfigured, result.Status);
        Assert.Contains("TicketBlDateFrom", result.Detail);
        Assert.Equal(0, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TicketsWithNoDetailForAKnownProducer_AreDroppedEntirely()
    {
        var client = new StubClient(_ => Page(false,
            Ticket("1", KnownProducer),
            Ticket("2", "SOMEELEVATOR"),
            Ticket("3", "XM6229", "OTHERCO")));

        var result = await Sut(client, Config()).GetAsync(CancellationToken.None);

        Assert.Equal("1", Assert.Single(result.Tickets).TicketNumber);
        Assert.Equal(3, result.ScannedInWindow);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task SplitTickets_KeepOnlyOurProducersDetailRows()
    {
        // A physical ticket can carry many parties. Holding the rest would cost memory to answer
        // questions no screen asks, and could leak another producer's quantities into a mapped result.
        var client = new StubClient(_ => Page(false, Ticket("1", "OTHERCO", KnownProducer, "XM6229")));

        var result = await Sut(client, Config()).GetAsync(CancellationToken.None);

        var kept = Assert.Single(result.Tickets);
        var detail = Assert.Single(kept.Details);
        Assert.Equal(KnownProducer, detail.CustomerCode);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task WalksEveryPage_AndCachesTheResult()
    {
        var client = new StubClient(page => Page(page < 2, Ticket($"{page}a", KnownProducer), Ticket($"{page}b", KnownProducer)));
        var sut = Sut(client, Config());

        var first = await sut.GetAsync(CancellationToken.None);
        await sut.GetAsync(CancellationToken.None);

        Assert.Equal(3, client.Calls);       // three pages, then cached
        Assert.Equal(6, first.Tickets.Count);
        Assert.False(first.Truncated);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task HittingThePageCap_IsReportedAsTruncated()
    {
        var client = new StubClient(page => Page(true, Ticket($"{page}", KnownProducer)));

        var result = await Sut(client, Config(maxPages: 2)).GetAsync(CancellationToken.None);

        Assert.True(result.Truncated);
        Assert.Equal(2, client.Calls);
        Assert.Contains("TRUNCATED", result.Detail);
    }
}
