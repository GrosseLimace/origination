// Microsoft namespaces
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Covers how the live ticket reader scopes, caches and coalesces its reads.
/// </summary>
/// <remarks>
/// The reader has two entry points that share one cache, so the tests here focus on the things that go
/// wrong quietly: an empty contract set turning into an unfiltered query, two callers being served the
/// wrong scope because their cache keys collided, and a failed read being cached long enough to look
/// like a producer with no tickets.
/// </remarks>
public class CtrmTicketReaderTests
{
    private const string Producer = "TESTPROD";

    /// <summary>
    /// Records every document and variable set it is asked for, and answers with one empty page.
    /// </summary>
    private sealed class RecordingClient : ICtrmGraphQlClient
    {
        private readonly CtrmReadStatus? _failWith;

        public RecordingClient(CtrmReadStatus? failWith = null) => _failWith = failWith;

        public bool IsConfigured { get; init; } = true;

        public List<string> Documents { get; } = [];
        public List<IReadOnlyDictionary<string, object?>> Variables { get; } = [];
        public int Calls => Documents.Count;

        /// <summary>When set, the client blocks here, so a test can hold a read in flight.</summary>
        public TaskCompletionSource Gate { get; } = new();

        /// <summary>Whether <see cref="Gate"/> is honoured. Off by default so most tests run straight through.</summary>
        public bool UseGate { get; init; }

        public async Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            lock (Documents)
            {
                Documents.Add(document);
                Variables.Add(ToMap(variables));
            }

            // The WAF rejects '#' comment lines, so no query document may contain one.
            Assert.DoesNotContain('#', document);

            if (UseGate) await Gate.Task;

            if (_failWith is { } status)
                return new CtrmReadResult<T> { Status = status, Detail = "stub failure" };

            var response = new CtrmTicketsResponse
            {
                Tickets = new CtrmPage<CtrmTicketDto>
                {
                    TotalCount = 0,
                    PageInfo = new CtrmPageInfo { HasNextPage = false },
                    Items = []
                }
            };

            return new CtrmReadResult<T> { Status = CtrmReadStatus.Ok, HttpStatus = 200, Value = (T)(object)response };
        }

        private static IReadOnlyDictionary<string, object?> ToMap(object? variables) =>
            variables as IReadOnlyDictionary<string, object?>
            ?? variables?.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(variables))
            ?? new Dictionary<string, object?>();
    }

    private static IConfiguration Config(int lookbackDays = 365, int cacheSeconds = 60) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:TicketLookbackDays"] = lookbackDays.ToString(),
            ["Ctrm:LiveCacheSeconds"] = cacheSeconds.ToString()
        }).Build();

    private static CtrmTicketReader Sut(ICtrmGraphQlClient client, IConfiguration? config = null) =>
        new(client, config ?? Config(), new Mock<ILogger<CtrmTicketReader>>().Object);

    // -------------------------------------------------------------------------
    [Fact]
    public async Task EmptyContractSetNeverReachesTheServer()
    {
        // The most dangerous input in this class. `tickets` with no contract filter is an unbounded scan
        // over the whole bill-of-lading window, so an empty set has to short-circuit rather than degrade
        // into "fetch everything". A producer with no open contracts is a normal case, not an error.
        var client = new RecordingClient();

        var result = await Sut(client).GetForContractsAsync([], CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Empty(result.Value ?? []);
        Assert.Equal(0, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ContractSetOfBlanksIsTreatedAsEmpty()
    {
        // Contract numbers arrive from mapped CTRM rows, where an unassigned one is blank or whitespace.
        // Passing those through would filter on "" and match nothing, or worse be dropped server-side.
        var client = new RecordingClient();

        var result = await Sut(client).GetForContractsAsync(["", "   ", null!], CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(0, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task BlankProducerCodeNeverReachesTheServer()
    {
        var client = new RecordingClient();

        var result = await Sut(client).GetForProducerAsync("   ", CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Equal(0, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ProducerAndContractReadsUseDifferentDocumentsAndFilters()
    {
        // One cache backs both entry points, so the scope has to travel with the request. Getting this
        // wrong would serve a contract-scoped answer to a producer query and look like missing tickets.
        var client = new RecordingClient();
        var sut = Sut(client, Config(lookbackDays: 30));

        await sut.GetForProducerAsync(Producer, CancellationToken.None);
        await sut.GetForContractsAsync(["PZZ900001"], CancellationToken.None);

        Assert.Equal(2, client.Calls);

        Assert.Contains("customerId", client.Documents[0]);
        Assert.Equal(Producer, client.Variables[0]["customerId"]);
        Assert.DoesNotContain("contractNumbers", client.Documents[0]);

        Assert.Contains("contractNumbers", client.Documents[1]);
        Assert.DoesNotContain("customerId", client.Documents[1]);
        Assert.Equal(new[] { "PZZ900001" }, Assert.IsAssignableFrom<IEnumerable<string>>(client.Variables[1]["contractNumbers"]));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task EveryReadAsksTheServerToExcludeCancelledAndConsolidatedRows()
    {
        // These duplicate filters CtrmMappings also applies. Pinned here because dropping them silently
        // widens the population the screen shows, and the mapping-level check would still hide it.
        var client = new RecordingClient();
        var sut = Sut(client, Config(lookbackDays: 30));

        await sut.GetForProducerAsync(Producer, CancellationToken.None);
        await sut.GetForContractsAsync(["PZZ900001"], CancellationToken.None);

        Assert.All(client.Documents, d =>
        {
            Assert.Contains("excludeCancelled: true", d);
            Assert.Contains("excludeConsolidated: true", d);
        });
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task EveryWindowCarriesADateRangeWithinTheServerCap()
    {
        // The range is mandatory for both filters and rejected outright past the cap, so a missing or
        // over-wide window fails the whole read rather than returning less.
        var client = new RecordingClient();

        await Sut(client, Config(lookbackDays: 1095)).GetForProducerAsync(Producer, CancellationToken.None);

        Assert.Equal(3, client.Calls);
        Assert.All(client.Variables, v =>
        {
            var from = DateTime.Parse((string)v["from"]!);
            var to = DateTime.Parse((string)v["to"]!);
            Assert.True((to - from).TotalDays <= CtrmQueries.MaxTicketRangeDays);
        });
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("PZZ900002", "PZZ900001")]
    [InlineData("PZZ900001", "PZZ900002")]
    public async Task ContractOrderDoesNotSplitTheCache(string first, string second)
    {
        // Callers build this set from a contract list whose order is not guaranteed. Keying on the raw
        // order would double every read for no benefit, and halve the cache hit rate at random.
        var client = new RecordingClient();
        var sut = Sut(client, Config(lookbackDays: 30));

        await sut.GetForContractsAsync([first, second], CancellationToken.None);
        await sut.GetForContractsAsync([second, first], CancellationToken.None);

        Assert.Equal(1, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ADifferentContractSetIsADifferentRead()
    {
        // The flip side of the normalization above: sharing a key across genuinely different sets would
        // serve one contract's tickets for another's.
        var client = new RecordingClient();
        var sut = Sut(client, Config(lookbackDays: 30));

        await sut.GetForContractsAsync(["PZZ900002"], CancellationToken.None);
        await sut.GetForContractsAsync(["PZZ900001"], CancellationToken.None);

        Assert.Equal(2, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ProducerAndContractScopesDoNotShareACacheEntry()
    {
        var client = new RecordingClient();
        var sut = Sut(client, Config(lookbackDays: 30));

        await sut.GetForProducerAsync("PZZ900001", CancellationToken.None);
        await sut.GetForContractsAsync(["PZZ900001"], CancellationToken.None);

        // Same string, different meaning. An unprefixed key would collide and answer the second from the first.
        Assert.Equal(2, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ConcurrentCallersForTheSameProducerShareOneRequest()
    {
        // Selecting a producer asks for the full ticket list and the unapplied subset at almost the same
        // moment. Caching only completed results would let both fire; the cache holds the in-flight task.
        var client = new RecordingClient { UseGate = true };
        var sut = Sut(client, Config(lookbackDays: 30));

        var first = sut.GetForProducerAsync(Producer, CancellationToken.None);
        var second = sut.GetForProducerAsync(Producer, CancellationToken.None);

        client.Gate.SetResult();
        await Task.WhenAll(first, second);

        Assert.Equal(1, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AFailedReadIsNotCached()
    {
        // A transient failure must not lock a producer out of the screen until the TTL happens to expire,
        // because an empty ticket pane is indistinguishable from a producer who has none.
        var client = new RecordingClient(CtrmReadStatus.Unauthorized);
        var sut = Sut(client, Config(lookbackDays: 30, cacheSeconds: 3600));

        var first = await sut.GetForProducerAsync(Producer, CancellationToken.None);
        var second = await sut.GetForProducerAsync(Producer, CancellationToken.None);

        Assert.False(first.Ok);
        Assert.False(second.Ok);
        Assert.Equal(2, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task OneFailedWindowFailsTheWholeRead()
    {
        // A partial list is worse than an error here: it renders as a shorter ticket history with nothing
        // on screen to say a year is missing.
        var client = new RecordingClient(CtrmReadStatus.Error);

        var result = await Sut(client, Config(lookbackDays: 1095)).GetForProducerAsync(Producer, CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Empty(result.Value ?? []);
    }
}
