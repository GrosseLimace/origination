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
/// Covers the live contract reader, with the crop-year batch read as the focus.
/// </summary>
/// <remarks>
/// The batch read is the risky one. It chunks a producer set against a server-enforced 500-entry cap and
/// pages each chunk, so the failures that matter are the quiet ones: an empty set degrading into an
/// unfiltered query, a chunk boundary dropping producers, and a cache key that collides across trade
/// units or crop years.
/// </remarks>
public class CtrmContractReaderTests
{
    /// <summary>
    /// Serves canned contract pages and records every document and variable set it was asked for.
    /// </summary>
    private sealed class RecordingClient : ICtrmGraphQlClient
    {
        private readonly int _totalPerChunk;
        private readonly CtrmReadStatus? _failWith;

        /// <param name="totalPerChunk">Rows a chunk reports, so paging can be exercised.</param>
        public RecordingClient(int totalPerChunk = 1, CtrmReadStatus? failWith = null)
        {
            _totalPerChunk = totalPerChunk;
            _failWith = failWith;
        }

        public bool IsConfigured { get; init; } = true;

        public List<string> Documents { get; } = [];
        public List<IReadOnlyDictionary<string, object?>> Variables { get; } = [];
        public int Calls => Documents.Count;

        /// <summary>Fails only requests at a non-zero skip, to exercise a mid-walk failure.</summary>
        public bool FailLaterPagesOnly { get; init; }

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            var map = ToMap(variables);
            lock (Documents)
            {
                Documents.Add(document);
                Variables.Add(map);
            }

            // The WAF rejects '#' comment lines, so no query document may contain one.
            Assert.DoesNotContain('#', document);

            var skip = map.TryGetValue("skip", out var s) ? Convert.ToInt32(s) : 0;
            var shouldFail = _failWith is not null && (!FailLaterPagesOnly || skip > 0);

            if (shouldFail)
                return Task.FromResult(new CtrmReadResult<T> { Status = _failWith!.Value, Detail = "stub failure" });

            var take = map.TryGetValue("take", out var t) ? Convert.ToInt32(t) : 500;
            var remaining = Math.Max(0, _totalPerChunk - skip);
            var count = Math.Min(take, remaining);

            var response = new CtrmContractsResponse
            {
                Contracts = new CtrmPage<CtrmContractDto>
                {
                    TotalCount = _totalPerChunk,
                    PageInfo = new CtrmPageInfo { Skip = skip, Take = take, HasNextPage = skip + count < _totalPerChunk },
                    Items = [.. Enumerable.Range(0, count).Select(i => new CtrmContractDto
                    {
                        ContractId = $"P{skip + i:D7}",
                        ContractPrefixType = "P",
                        CustomerId = "TESTPRD",
                        CropYear = 2025
                    })]
                }
            };

            return Task.FromResult(new CtrmReadResult<T>
            {
                Status = CtrmReadStatus.Ok,
                HttpStatus = 200,
                Value = (T)(object)response
            });
        }

        private static IReadOnlyDictionary<string, object?> ToMap(object? variables) =>
            variables as IReadOnlyDictionary<string, object?>
            ?? variables?.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(variables))
            ?? new Dictionary<string, object?>();
    }

    /// <param name="strategy">Which trade-unit contract strategy to exercise. The batch tests below predate
    /// the per-producer default and assert the customerIds shape, so they name it explicitly.</param>
    private static IConfiguration Config(int cacheSeconds = 60, int concurrency = 4, string strategy = "customerIds") =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:LiveCacheSeconds"] = cacheSeconds.ToString(),
            ["Ctrm:PageConcurrency"] = concurrency.ToString(),
            ["Ctrm:TradeUnitContractStrategy"] = strategy,
            ["Ctrm:TradeUnitPerProducerConcurrency"] = "8",
            ["Ctrm:ServerTimeoutRetryDelaySeconds"] = "0"
        }).Build();

    private static CtrmContractReader Sut(ICtrmGraphQlClient client, IConfiguration? config = null) =>
        new(client, config ?? Config(), new Mock<ILogger<CtrmContractReader>>().Object);

    private static List<string> Codes(int count) =>
        [.. Enumerable.Range(0, count).Select(i => $"P{i:D6}")];

    // -------------------------------------------------------------------------
    [Fact]
    public async Task EmptyProducerSetNeverReachesTheServer()
    {
        // The dangerous input. Without customerIds the server demands a date range, and given one it would
        // return every counterparty in the library rather than nothing.
        var client = new RecordingClient();

        var result = await Sut(client).GetForProducersAsync([], CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Empty(result.Value ?? []);
        Assert.Equal(0, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task BlanksAndDuplicatesAreDiscardedBeforeTheCallIsMade()
    {
        var client = new RecordingClient();

        var result = await Sut(client).GetForProducersAsync(
            ["P00001", " p00001 ", "", "   ", null!], CancellationToken.None);

        Assert.True(result.Ok);
        var ids = Assert.IsAssignableFrom<IEnumerable<string>>(client.Variables[0]["customerIds"]);
        Assert.Single(ids);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(1, 1)]
    [InlineData(500, 1)]     // exactly the server cap - must not split
    [InlineData(501, 2)]
    [InlineData(1200, 3)]
    public async Task ProducerSetIsChunkedToTheServerCap(int producers, int expectedChunks)
    {
        // customerIds is capped at 500 server-side. Over-filling it fails the request outright; under-
        // filling it multiplies a per-chunk cost that measurement showed is flat regardless of list size.
        var client = new RecordingClient();

        await Sut(client).GetForProducersAsync(Codes(producers), CancellationToken.None);

        Assert.Equal(expectedChunks, client.Calls);
        Assert.All(client.Variables, v =>
            Assert.InRange(Assert.IsAssignableFrom<IEnumerable<string>>(v["customerIds"]).Count(), 1, 500));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task EveryProducerLandsInExactlyOneChunk()
    {
        // A chunk-boundary slip would silently drop producers from a Build-a-List result, which reads as
        // "those growers do not match" rather than as a bug.
        var codes = Codes(1200);
        var client = new RecordingClient();

        await Sut(client).GetForProducersAsync(codes, CancellationToken.None);

        var sent = client.Variables
            .SelectMany(v => Assert.IsAssignableFrom<IEnumerable<string>>(v["customerIds"]))
            .ToList();

        Assert.Equal(codes.Count, sent.Count);
        Assert.Equal(codes.Count, sent.Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.Empty(codes.Except(sent, StringComparer.OrdinalIgnoreCase));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task PurchaseFilterGoesToTheServerAndCropYearDoesNot()
    {
        // Purchase-only is a server argument so sale contracts never cross the wire. Crop year deliberately
        // is NOT: the batch read is the producers' full history, filtered by crop year in memory, because the
        // server's response cache once keyed cropYear out and handed back the wrong year (2026-08-26).
        var client = new RecordingClient();

        await Sut(client).GetForProducersAsync(Codes(2), CancellationToken.None);

        Assert.Equal("P", client.Variables[0]["prefix"]);
        Assert.False(client.Variables[0].ContainsKey("cropYear"));
        Assert.DoesNotContain("cropYear: $cropYear", client.Documents[0]);   // the FIELD is still projected; the ARGUMENT is not sent
        Assert.DoesNotContain("contractDateFrom", client.Documents[0]);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TheBatchListDoesNotProjectPricingLines()
    {
        // Pricing lines are the expensive half of a contract page - 8.1s against 4.0s on a 500-row page -
        // and nothing in a contract list reads them. Pinned because it is invisible if it regresses.
        var client = new RecordingClient();

        await Sut(client).GetForProducersAsync(Codes(1), CancellationToken.None);

        Assert.DoesNotContain("prices", client.Documents[0]);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task PagesUntilTheServerSaysThereIsNoMore()
    {
        // 1,200 rows at 500 a page is three requests for one chunk.
        var client = new RecordingClient(totalPerChunk: 1200);

        var result = await Sut(client).GetForProducersAsync(Codes(10), CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(1200, (result.Value ?? []).Count);
        Assert.Equal(3, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ProducerOrderDoesNotSplitTheCache()
    {
        // The producer set comes from a database query whose order is not guaranteed. Keying on raw order
        // would halve the hit rate at random.
        var codes = Codes(20);
        var client = new RecordingClient();
        var sut = Sut(client);

        await sut.GetForProducersAsync(codes, CancellationToken.None);
        await sut.GetForProducersAsync([.. codes.AsEnumerable().Reverse()], CancellationToken.None);

        Assert.Equal(1, client.Calls);
    }


    // -------------------------------------------------------------------------
    [Fact]
    public async Task ADifferentProducerSetIsADifferentRead()
    {
        // The flip side of order-independence: sharing a key across genuinely different sets would serve
        // one trade unit's contracts to another.
        var client = new RecordingClient();
        var sut = Sut(client);

        await sut.GetForProducersAsync(Codes(5), CancellationToken.None);
        await sut.GetForProducersAsync(Codes(6), CancellationToken.None);

        Assert.Equal(2, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TheSingleProducerScopeAndTheBatchScopeDoNotShareACacheEntry()
    {
        var client = new RecordingClient();
        var sut = Sut(client);

        await sut.GetForProducerAsync("TESTPRD", CancellationToken.None);
        await sut.GetForProducersAsync(["TESTPRD"], CancellationToken.None);

        Assert.Equal(2, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task OneFailedChunkFailsTheWholeRead()
    {
        // A partial list renders as a shorter producer list with nothing on screen to say a batch is
        // missing, which is worse than an error.
        var client = new RecordingClient(failWith: CtrmReadStatus.Unauthorized);

        var result = await Sut(client).GetForProducersAsync(Codes(1200), CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Empty(result.Value ?? []);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AFailureOnALaterPageStillFailsTheRead()
    {
        // The first page succeeding is what makes this the easy case to get wrong: the walk has already
        // produced rows by the time the failure lands.
        var client = new RecordingClient(totalPerChunk: 1200, failWith: CtrmReadStatus.Error)
        {
            FailLaterPagesOnly = true
        };

        var result = await Sut(client).GetForProducersAsync(Codes(10), CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Empty(result.Value ?? []);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AFailedReadIsNotCached()
    {
        var client = new RecordingClient(failWith: CtrmReadStatus.Error);
        var sut = Sut(client, Config(cacheSeconds: 3600));

        await sut.GetForProducersAsync(Codes(1), CancellationToken.None);
        await sut.GetForProducersAsync(Codes(1), CancellationToken.None);

        Assert.Equal(2, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AnOverLongProducerCodeIsDroppedRatherThanSentWithTheChunk()
    {
        // Measured against live QA: a customer code of 8 characters or more makes customerIds answer
        // "An internal error occurred" instead of matching nothing — and it fails the WHOLE request, so one
        // bad code in a chunk of 500 loses every producer in it. Real ScoularIds are 5-7 characters, so
        // this only trips on bad data; the blast radius is what makes dropping it the safer choice.
        var client = new RecordingClient();

        var result = await Sut(client).GetForProducersAsync(
            ["P00001", "TOOLONG8", "P00002"], CancellationToken.None);

        Assert.True(result.Ok);

        var sent = Assert.IsAssignableFrom<IEnumerable<string>>(client.Variables[0]["customerIds"]).ToList();
        Assert.Equal(2, sent.Count);
        Assert.DoesNotContain("TOOLONG8", sent);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AProducerSetOfNothingButOverLongCodesNeverReachesTheServer()
    {
        // Dropping every code leaves an empty set, and an empty set must not degrade into an unfiltered
        // query — the same trap as passing none in the first place.
        var client = new RecordingClient();

        var result = await Sut(client).GetForProducersAsync(
            ["WAYTOOLONG", "ALSOTOOLONG"], CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Empty(result.Value ?? []);
        Assert.Equal(0, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TheDefaultStrategyIsOneIndexedCallPerProducer()
    {
        // Measured 2026-08-27: the singular filter is indexed (~1.5s), the customerIds list is a ~25s scan
        // that trips the server's own 30s limit under load. Hundreds of cheap calls beat scans that never
        // finish, so per-producer is the default until the API owner fixes the list plan.
        var client = new RecordingClient();

        var result = await Sut(client, Config(strategy: "perProducer")).GetForProducersAsync(Codes(12), CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(12, client.Calls);
        Assert.All(client.Documents, d =>
        {
            Assert.Contains("customerId: $customerId", d);
            Assert.DoesNotContain("customerIds", d);
            Assert.DoesNotContain("prices", d);          // a contract list never reads pricing lines
        });
        Assert.All(client.Variables, v => Assert.Equal("P", v["prefix"]));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task EveryProducerIsAskedForExactlyOnceInThePerProducerStrategy()
    {
        var client = new RecordingClient();
        var codes = Codes(40);

        await Sut(client, Config(strategy: "perProducer")).GetForProducersAsync(codes, CancellationToken.None);

        var asked = client.Variables.Select(v => (string)v["customerId"]!).ToList();
        Assert.Equal(40, asked.Distinct().Count());
        Assert.Empty(codes.Except(asked));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task OneProducerFailingTwiceFailsTheWholeReadRatherThanShorteningTheList()
    {
        // A silently shorter producer list is the worst outcome: Build-a-List would render it as fact.
        var client = new RecordingClient(failWith: CtrmReadStatus.Unauthorized);

        var result = await Sut(client, Config(strategy: "perProducer")).GetForProducersAsync(Codes(3), CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Empty(result.Value ?? []);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TheStrategyIsConfigurableBackToTheListFilter()
    {
        // The list shape is one flip away for when the server can run it.
        var client = new RecordingClient();

        await Sut(client, Config(strategy: "customerIds")).GetForProducersAsync(Codes(12), CancellationToken.None);

        Assert.Equal(1, client.Calls);
        Assert.Contains("customerIds: $customerIds", client.Documents[0]);
    }
}
