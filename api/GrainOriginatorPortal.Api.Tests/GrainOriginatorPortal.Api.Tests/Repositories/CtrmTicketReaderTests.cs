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
    private const string Producer = "TESTPRD";

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

        /// <summary>Parks the NEXT call only, then clears itself - for stale-while-revalidate tests.</summary>
        public volatile bool HoldNextCall;

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
            if (HoldNextCall) { HoldNextCall = false; await Gate.Task; }

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

    private static IConfiguration Config(int lookbackDays = 365, int cacheSeconds = 60, int historicalMinutes = 30) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:TicketLookbackDays"] = lookbackDays.ToString(),
            ["Ctrm:LiveCacheSeconds"] = cacheSeconds.ToString(),
            ["Ctrm:HistoricalTicketCacheMinutes"] = historicalMinutes.ToString()
        }).Build();

    private static CtrmTicketReader Sut(ICtrmGraphQlClient client, IConfiguration? config = null, Func<DateTime>? clock = null) =>
        new(client, config ?? Config(), new Mock<ILogger<CtrmTicketReader>>().Object, clock);

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

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ABatchedProducerReadUsesOneWindowAndTheBatchDocument()
    {
        // The point of this read: one narrow window instead of the sliced three-year lookback. The cost of
        // a ticket query is the header scan, not the rows, so 30 days is one request per chunk where three
        // years is about a thousand pages.
        var client = new RecordingClient();

        var result = await Sut(client).GetForProducersAsync(
            [Producer], new DateTime(2026, 7, 26), new DateTime(2026, 8, 26), CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(1, client.Calls);
        Assert.Contains("customerIds", client.Documents[0]);
        Assert.Contains("excludeCancelled: true", client.Documents[0]);
        Assert.Equal("2026-07-26", client.Variables[0]["from"]);
        Assert.Equal("2026-08-26", client.Variables[0]["to"]);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ABatchedReadRejectsAWindowWiderThanTheServerCap()
    {
        // Failing here beats letting the server reject it: the caller chose this range precisely because a
        // narrow one is what makes the read affordable, so a too-wide range is a caller bug.
        var client = new RecordingClient();

        var result = await Sut(client).GetForProducersAsync(
            [Producer], new DateTime(2024, 1, 1), new DateTime(2026, 1, 1), CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Equal(0, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(1, 1)]
    [InlineData(500, 1)]
    [InlineData(501, 2)]
    public async Task ABatchedReadChunksToTheCustomerIdsCap(int producers, int expectedChunks)
    {
        var codes = Enumerable.Range(0, producers).Select(i => $"P{i:D6}").ToList();
        var client = new RecordingClient();

        await Sut(client).GetForProducersAsync(
            codes, new DateTime(2026, 8, 1), new DateTime(2026, 8, 26), CancellationToken.None);

        Assert.Equal(expectedChunks, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ABatchedReadDropsOverLongCodesRatherThanFailingTheChunk()
    {
        // Same measured limit as the contract reader, from the same shared helper: 8 characters makes
        // customerIds answer an internal error and takes the whole chunk with it.
        var client = new RecordingClient();

        var result = await Sut(client).GetForProducersAsync(
            ["P00001", "TOOLONG8"], new DateTime(2026, 8, 1), new DateTime(2026, 8, 26), CancellationToken.None);

        Assert.True(result.Ok);
        var ids = Assert.IsAssignableFrom<IEnumerable<string>>(client.Variables[0]["customerIds"]).ToList();
        Assert.Single(ids);
        Assert.DoesNotContain("TOOLONG8", ids);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AnEmptyBatchedProducerSetNeverReachesTheServer()
    {
        var client = new RecordingClient();

        var result = await Sut(client).GetForProducersAsync(
            [], new DateTime(2026, 8, 1), new DateTime(2026, 8, 26), CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(0, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ADifferentWindowIsADifferentBatchedRead()
    {
        // The window is part of the question, so it has to be part of the cache key - otherwise yesterday's
        // answer would be served for today's.
        var client = new RecordingClient();
        var sut = Sut(client);

        await sut.GetForProducersAsync([Producer], new DateTime(2026, 8, 1), new DateTime(2026, 8, 26), CancellationToken.None);
        await sut.GetForProducersAsync([Producer], new DateTime(2026, 8, 2), new DateTime(2026, 8, 26), CancellationToken.None);

        Assert.Equal(2, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ABatchedReadDoesNotShareACacheEntryWithThePerProducerRead()
    {
        var client = new RecordingClient();
        var sut = Sut(client, Config(lookbackDays: 30));

        await sut.GetForProducerAsync(Producer, CancellationToken.None);
        await sut.GetForProducersAsync([Producer], new DateTime(2026, 8, 1), new DateTime(2026, 8, 26), CancellationToken.None);

        Assert.Equal(2, client.Calls);
    }
    // -------------------------------------------------------------------------
    [Fact]
    public async Task AfterTheLiveTtl_OnlyTheWindowContainingTodayIsRefetched()
    {
        // The point of the per-window cache. Older windows hold tickets that rarely change and cost the
        // most to fetch, so a repeat visit after the short outer TTL should pay for the current window only.
        var now = new DateTime(2026, 8, 25, 12, 0, 0, DateTimeKind.Utc);
        var client = new RecordingClient();
        var sut = Sut(client, Config(lookbackDays: 1095, cacheSeconds: 60), () => now);

        await sut.GetForProducerAsync(Producer, CancellationToken.None);
        Assert.Equal(3, client.Calls);

        now = now.AddSeconds(61);
        await sut.GetForProducerAsync(Producer, CancellationToken.None);

        Assert.Equal(4, client.Calls);
        var refetched = client.Variables[3];
        Assert.True(DateTime.Parse((string)refetched["to"]!) > DateTime.Today.AddDays(-1),
            "the one refetched window must be the one that contains today");
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task HistoricalWindows_RefetchAfterTheirOwnLongerTtl()
    {
        // Older tickets can still change - a late settlement, a consolidation - so the historical TTL is a
        // bound on staleness, not a promise of immutability. Past it, everything goes back to CTRM.
        var now = new DateTime(2026, 8, 25, 12, 0, 0, DateTimeKind.Utc);
        var client = new RecordingClient();
        var sut = Sut(client, Config(lookbackDays: 1095, cacheSeconds: 60, historicalMinutes: 30), () => now);

        await sut.GetForProducerAsync(Producer, CancellationToken.None);
        now = now.AddMinutes(31);
        await sut.GetForProducerAsync(Producer, CancellationToken.None);

        Assert.Equal(6, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task WithinTheLiveTtl_NothingIsRefetched()
    {
        // The outer entry still coalesces: the full list and the unapplied subset arrive together.
        var now = new DateTime(2026, 8, 25, 12, 0, 0, DateTimeKind.Utc);
        var client = new RecordingClient();
        var sut = Sut(client, Config(lookbackDays: 1095, cacheSeconds: 60), () => now);

        await sut.GetForProducerAsync(Producer, CancellationToken.None);
        now = now.AddSeconds(30);
        await sut.GetForProducerAsync(Producer, CancellationToken.None);

        Assert.Equal(3, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Invalidate_DropsTheWindowsBeneathTheProducerToo()
    {
        // Otherwise a forced refresh would rebuild the outer entry from three cached windows and change
        // nothing - the opposite of what Invalidate promises.
        var client = new RecordingClient();
        var sut = Sut(client, Config(lookbackDays: 1095));

        await sut.GetForProducerAsync(Producer, CancellationToken.None);
        sut.Invalidate(Producer);
        await sut.GetForProducerAsync(Producer, CancellationToken.None);

        Assert.Equal(6, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TheTradeUnitHistoryRead_CoversEveryWindowWithTheBatchDocument()
    {
        // Trade units -> producers -> their tickets over the whole lookback: three windows for three years,
        // each carrying the full producer set, none asking for unappliedOnly (the delivered and unsettled
        // prompts need the applied half).
        var client = new RecordingClient();

        var result = await Sut(client, Config(lookbackDays: 1095)).GetForProducersHistoryAsync(Codes(3), CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(3, client.Calls);
        Assert.All(client.Documents, d => Assert.Contains("customerIds: $customerIds", d));
        Assert.All(client.Variables, v =>
        {
            Assert.Equal(3, Assert.IsAssignableFrom<IEnumerable<string>>(v["customerIds"]).Count());
            Assert.False(v.ContainsKey("unappliedOnly"));
            var from = DateTime.Parse((string)v["from"]!); var to = DateTime.Parse((string)v["to"]!);
            Assert.True((to - from).TotalDays <= CtrmQueries.MaxTicketRangeDays);
        });
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TheTradeUnitHistoryRead_ServesTheExpiredCopyInstantlyAndRefreshesBehindIt()
    {
        // The contract with Build-a-List: a prompt run after the TTL must not wait on a multi-page walk that
        // has already been answered once. The caller gets the old copy; the refresh starts; the NEXT caller
        // sees the refreshed one.
        var now = new DateTime(2026, 8, 25, 12, 0, 0, DateTimeKind.Utc);
        var client = new RecordingClient();
        var sut = Sut(client, Config(lookbackDays: 366, cacheSeconds: 60), () => now);
        var codes = Codes(5);

        await sut.GetForProducersHistoryAsync(codes, CancellationToken.None);
        Assert.Equal(1, client.Calls);

        now = now.AddSeconds(61);
        client.HoldNextCall = true;
        var stale = sut.GetForProducersHistoryAsync(codes, CancellationToken.None);

        // Returned without waiting on the refresh that is now parked at the gate.
        Assert.True(stale.IsCompleted, "the expired copy must be served without awaiting the refresh");
        Assert.True((await stale).Ok);
        Assert.Equal(2, client.Calls);

        client.Gate.SetResult();
        await Task.Yield();
        now = now.AddSeconds(1);
        await sut.GetForProducersHistoryAsync(codes, CancellationToken.None);
        Assert.Equal(2, client.Calls);   // the refresh landed; nothing else was fetched
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task EveryCallerDuringARefreshIsServedTheOldCopy_NotJustTheFirst()
    {
        // The bug this pins: the first stale caller got the old copy, then the in-flight refresh was swapped
        // into the slot - so everyone arriving during the refresh found a fresh-LOOKING, not-yet-complete
        // entry and blocked on the multi-page walk. Stale-while-revalidate has to cover all of them.
        var now = new DateTime(2026, 8, 25, 12, 0, 0, DateTimeKind.Utc);
        var client = new RecordingClient();
        var sut = Sut(client, Config(lookbackDays: 366, cacheSeconds: 60), () => now);
        var codes = Codes(5);

        await sut.GetForProducersHistoryAsync(codes, CancellationToken.None);

        now = now.AddSeconds(61);
        client.HoldNextCall = true;
        var first = sut.GetForProducersHistoryAsync(codes, CancellationToken.None);
        Assert.True(first.IsCompleted, "first stale caller should not wait");

        // Second and third arrive while the refresh is still parked at the gate.
        var second = sut.GetForProducersHistoryAsync(codes, CancellationToken.None);
        var third = sut.GetForProducersHistoryAsync(codes, CancellationToken.None);

        Assert.True(second.IsCompleted, "a caller arriving mid-refresh blocked on it instead of getting the old copy");
        Assert.True(third.IsCompleted, "a caller arriving mid-refresh blocked on it instead of getting the old copy");
        Assert.True((await second).Ok);
        Assert.True((await third).Ok);
        Assert.Equal(2, client.Calls);   // one original + one refresh; no caller triggered another

        client.Gate.SetResult();
        await Task.Yield();
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ASweepDoesNotEvictATradeUnitWindowThatStaleWhileRevalidateStillNeeds()
    {
        // The sweep ran on expiry alone, which is exactly when a trade-unit window becomes SWR-eligible -
        // dropping it there sent Build-a-List back to waiting on the walk.
        var now = new DateTime(2026, 8, 25, 12, 0, 0, DateTimeKind.Utc);
        var client = new RecordingClient();
        var sut = Sut(client, Config(lookbackDays: 366, cacheSeconds: 60), () => now);
        var codes = Codes(5);

        await sut.GetForProducersHistoryAsync(codes, CancellationToken.None);
        Assert.Equal(1, client.Calls);

        // Push past the window TTL, then churn enough distinct producer reads to trigger a sweep (every 64).
        now = now.AddSeconds(61);
        for (var i = 0; i < 70; i++)
            await sut.GetForProducerAsync($"SWEEP{i:D2}", CancellationToken.None);
        var callsAfterChurn = client.Calls;

        // The trade-unit entry should still be there to serve stale.
        client.HoldNextCall = true;
        var stale = sut.GetForProducersHistoryAsync(codes, CancellationToken.None);

        Assert.True(stale.IsCompleted, "the trade-unit window was swept away and the caller had to wait");
        Assert.True((await stale).Ok);
        Assert.Equal(callsAfterChurn + 1, client.Calls);   // exactly one refresh, no re-walk

        client.Gate.SetResult();
        await Task.Yield();
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TheTradeUnitHistoryRead_IsWarmOnceEveryWindowIsCached()
    {
        var client = new RecordingClient();
        var sut = Sut(client, Config(lookbackDays: 1095));
        var codes = Codes(4);

        Assert.False(sut.IsWarm(codes));
        await sut.GetForProducersHistoryAsync(codes, CancellationToken.None);
        Assert.True(sut.IsWarm(codes));
        Assert.False(sut.IsWarm(Codes(5)));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TheTradeUnitHistoryRead_SharesItsWindowsWithTheSingleWindowReadOverTheSameDates()
    {
        // Same producers, same window, same rows: a Spot Loads read that happens to match a history window
        // must reuse it rather than walk it again.
        var client = new RecordingClient();
        var sut = Sut(client, Config(lookbackDays: 366));
        var codes = Codes(2);

        await sut.GetForProducersHistoryAsync(codes, CancellationToken.None);
        var from = DateTime.Parse((string)client.Variables[0]["from"]!);
        var to = DateTime.Parse((string)client.Variables[0]["to"]!);
        await sut.GetForProducersAsync(codes, from, to, CancellationToken.None);

        Assert.Equal(1, client.Calls);
    }

    private static List<string> Codes(int count) =>
        [.. Enumerable.Range(0, count).Select(i => $"P{i:D6}")];
}
