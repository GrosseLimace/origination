// Microsoft namespaces
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Ctrm;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Covers how one ticket window is paged: in parallel batches, without ever losing a row, and without
/// asking the server for <c>totalCount</c>.
/// </summary>
/// <remarks>
/// <para>A sequential loop cost 13.3s on a producer with 821 tickets (measured 2026-08-27), so pages after
/// the first are fetched concurrently. Until 2026-11-04 the first page's <c>totalCount</c> sized that
/// fan-out. The CTRM team pays a count query for every page we fetch, and the count never decided anything
/// else, so the ticket documents dropped it and the walk now ramps a speculative batch (1, 2, 4 ... up to
/// <c>Ctrm:TicketPageBatch</c>), stopping on <c>hasNextPage</c>.</para>
///
/// <para>Three properties matter and none is visible if it regresses: a serial pump is merely slow, a pump
/// that drops a page silently understates a producer's deliveries, and a pump that over-fetches past the
/// end of every window hands the count query's cost straight back to the CTRM team as empty-page scans.</para>
/// </remarks>
[Collection("CtrmThrottle")]
public class CtrmTicketPagingTests
{
    private const string Producer = "TESTPRD";
    private const int PageSize = 500;
    private static readonly DateTime From = new(2026, 10, 1);
    private static readonly DateTime To = new(2026, 11, 7);

    /// <summary>Serves a fixed number of ticket rows in 500-row pages and records how the pump asked for
    /// them. A skip past the end answers an empty page with <c>hasNextPage</c> false, as the server does.</summary>
    private sealed class PagingClient : ICtrmGraphQlClient
    {
        private readonly int _totalRows;
        private readonly int? _reportTotalCount;
        private int _inFlight;

        /// <param name="totalRows">Rows actually available.</param>
        /// <param name="reportTotalCount">What totalCount claims, for the tests that prove it is ignored.</param>
        public PagingClient(int totalRows, int? reportTotalCount = null)
        {
            _totalRows = totalRows;
            _reportTotalCount = reportTotalCount;
        }

        public bool IsConfigured => true;
        public List<int> Skips { get; } = [];
        public int Calls => Skips.Count;
        public int PeakInFlight { get; private set; }

        /// <summary>Held pages let a test observe how many requests are open at once.</summary>
        public TaskCompletionSource Gate { get; } = new();

        /// <summary>Pages at or beyond this skip wait on <see cref="Gate"/>.</summary>
        public int? HoldPagesFromSkip { get; init; }

        /// <summary>The page at this skip fails.</summary>
        public int? FailAtSkip { get; init; }

        public async Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            var map = variables as IReadOnlyDictionary<string, object?>
                ?? variables?.GetType().GetProperties().ToDictionary(x => x.Name, x => x.GetValue(variables))
                ?? new Dictionary<string, object?>();
            var skip = map.TryGetValue("skip", out var s) ? Convert.ToInt32(s) : 0;

            lock (Skips)
            {
                Skips.Add(skip);
                var now = ++_inFlight;
                if (now > PeakInFlight) PeakInFlight = now;
            }

            try
            {
                if (HoldPagesFromSkip is { } hold && skip >= hold) await Gate.Task;

                if (FailAtSkip == skip)
                    return new CtrmReadResult<T> { Status = CtrmReadStatus.Error, HttpStatus = 500, Detail = "stub failure" };

                var remaining = Math.Max(0, _totalRows - skip);
                var count = Math.Min(PageSize, remaining);

                var response = new CtrmTicketsResponse
                {
                    Tickets = new CtrmPage<CtrmTicketDto>
                    {
                        // The documents no longer ask for it, so a real response carries none (0). A test
                        // that sets it is proving the pump never looks.
                        TotalCount = _reportTotalCount ?? 0,
                        PageInfo = new CtrmPageInfo { Skip = skip, Take = PageSize, HasNextPage = skip + count < _totalRows },
                        Items = [.. Enumerable.Range(0, count).Select(i => new CtrmTicketDto
                        {
                            TicketNumber = $"T{skip + i}",
                            TicketBLDate = new DateTime(2026, 8, 1),
                            Details = [new CtrmTicketDetailDto { CustomerCode = Producer, TicketType = "U", TicketSequenceNumber = 1 }]
                        })]
                    }
                };

                return new CtrmReadResult<T> { Status = CtrmReadStatus.Ok, HttpStatus = 200, Value = (T)(object)response };
            }
            finally
            {
                lock (Skips) _inFlight--;
            }
        }
    }

    private static IConfiguration Config(int? interactivePageConcurrency = null, int tradeUnitMaxPagesPerWindow = 200) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:TicketLookbackDays"] = "365",          // one window, so the test is about paging only
            ["Ctrm:LiveCacheSeconds"] = "60",
            ["Ctrm:BackgroundMaxDeferSeconds"] = "0",
            ["Ctrm:ServerTimeoutRetryDelaySeconds"] = "0",
            ["Ctrm:InteractiveServerTimeoutRetryDelaySeconds"] = "0",
            ["Ctrm:InteractivePageConcurrency"] = interactivePageConcurrency?.ToString(),
            ["Ctrm:TicketPageBatch"] = "4",
            ["Ctrm:TradeUnitTicketMaxPagesPerWindow"] = tradeUnitMaxPagesPerWindow.ToString(),
            ["Ctrm:ServeClickFromTradeUnitCache"] = "false",
        }).Build();

    private static CtrmTicketReader Sut(ICtrmGraphQlClient client, IConfiguration? config = null) =>
        new(client, config ?? Config(), new Mock<ILogger<CtrmTicketReader>>().Object);

    public CtrmTicketPagingTests() => CtrmTradeUnitThrottle.ResetForTests();

    // -------------------------------------------------------------------------
    [Fact]
    public void NoTicketDocumentAsksForTotalCount()
    {
        // The promise made to the CTRM team on 2026-11-04. If a document asks for it again, they are back to
        // running a count query for every page we fetch.
        foreach (var document in new[]
                 {
                     CtrmContractQueries.TicketsByCustomer, CtrmContractQueries.TicketsBySplitProducer,
                     CtrmContractQueries.TicketsByContractNumbers, CtrmContractQueries.TicketsByCustomers,
                     CtrmCustomerQueries.TicketLinksInWindow,
                 })
        {
            Assert.DoesNotContain("totalCount", document);
            Assert.Contains("hasNextPage", document);
        }
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ASinglePageWindowIsOneRequest()
    {
        var client = new PagingClient(totalRows: 42);

        var result = await Sut(client).GetForProducerAsync(Producer, CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(1, client.Calls);
        Assert.Equal(42, (result.Value ?? []).Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ATwoPageWindowIsExactlyTwoRequests()
    {
        // The common multi-page case (a busy producer, Spot Loads at harvest) must not pay for the missing
        // count: the first speculative batch is one page, so a two-page window requests exactly two.
        var client = new PagingClient(totalRows: 1000);

        var result = await Sut(client).GetForProducerAsync(Producer, CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(1000, (result.Value ?? []).Count);
        Assert.Equal([0, 500], client.Skips.OrderBy(x => x));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task EveryRowComesBackAcrossPages_AtMostOnePagePastTheEnd()
    {
        // 1,300 rows is three pages. Losing the tail would understate a producer's deliveries. The walk asks
        // 1, then 1, then a batch of 2 - which reaches one page past the end, the price of not knowing.
        var client = new PagingClient(totalRows: 1300);

        var result = await Sut(client).GetForProducerAsync(Producer, CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(1300, (result.Value ?? []).Count);
        Assert.Equal([0, 500, 1000, 1500], client.Skips.OrderBy(x => x));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ALongWindowCollectsEveryRowAndOverFetchesLessThanOneBatch()
    {
        // 18 pages. Every real page exactly once, in order, and never more than three empty pages past the
        // end (the batch cap is 4).
        var client = new PagingClient(totalRows: 18 * PageSize);

        var result = await Sut(client).GetForProducersAsync([Producer], From, To, CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(18 * PageSize, (result.Value ?? []).Count);
        Assert.Equal(Enumerable.Range(0, 18).Select(i => i * PageSize), client.Skips.OrderBy(x => x).Take(18));
        Assert.InRange(client.Calls, 18, 21);
        Assert.Equal(client.Calls, client.Skips.Distinct().Count());
        Assert.Equal(client.Calls, result.Pages);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task PagesInABatchAreFetchedConcurrently()
    {
        // The whole point of fetching in batches. Eight pages: after 1, 1 and 2, the batch of four
        // (skips 2000-3500) must all be open at the same time.
        var client = new PagingClient(totalRows: 4000) { HoldPagesFromSkip = 2000 };
        var sut = Sut(client);

        var read = sut.GetForProducerAsync(Producer, CancellationToken.None);

        while (client.Calls < 8) await Task.Delay(10);
        Assert.Equal(4, client.PeakInFlight);
        Assert.False(read.IsCompleted);

        client.Gate.SetResult();
        var result = await read;
        Assert.True(result.Ok);
        Assert.Equal(4000, (result.Value ?? []).Count);
        Assert.Equal(8, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task InteractivePagesAreBoundedByTheConfiguredConcurrency()
    {
        // A nine-page window across three windows is twenty-seven simultaneous requests for one click, and
        // the gateway was measured degrading at nine-way fan-out - so a batch never runs wider than
        // InteractivePageConcurrency. Eight pages, concurrency 2: of the batch of four, two at a time.
        var client = new PagingClient(totalRows: 4000) { HoldPagesFromSkip = 2000 };
        var sut = Sut(client, Config(interactivePageConcurrency: 2));

        var read = sut.GetForProducerAsync(Producer, CancellationToken.None);

        // 1 + 1 + 2 pages done, then two of the four held - the other two are still waiting for a slot.
        while (client.Calls < 6) await Task.Delay(10);
        await Task.Delay(150);
        Assert.Equal(6, client.Calls);
        Assert.Equal(2, client.PeakInFlight);
        Assert.False(read.IsCompleted);

        client.Gate.SetResult();
        var result = await read;
        Assert.True(result.Ok);
        Assert.Equal(4000, (result.Value ?? []).Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TotalCountIsNeverConsulted()
    {
        // The field is no longer requested, so whatever a server sends must change nothing: a wild
        // over-report must not send the pump chasing pages that do not exist, and an under-report must
        // not stop it short.
        var over = new PagingClient(totalRows: 600, reportTotalCount: 5000);
        var overResult = await Sut(over).GetForProducerAsync(Producer, CancellationToken.None);
        Assert.True(overResult.Ok);
        Assert.Equal(600, (overResult.Value ?? []).Count);
        Assert.Equal([0, 500], over.Skips.OrderBy(x => x));

        var under = new PagingClient(totalRows: 1500, reportTotalCount: 500);
        var underResult = await Sut(under).GetForProducerAsync(Producer, CancellationToken.None);
        Assert.True(underResult.Ok);
        Assert.Equal(1500, (underResult.Value ?? []).Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AWindowPastThePageCapIsReportedTruncatedNotComplete()
    {
        // The cap is a safety stop, not a load limiter: hitting it must surface as a partial answer so
        // Build-a-List can say so, exactly as it did when the count sized the walk.
        var client = new PagingClient(totalRows: 10 * PageSize);

        var result = await Sut(client, Config(tradeUnitMaxPagesPerWindow: 3))
            .GetForProducersAsync([Producer], From, To, CancellationToken.None);

        Assert.Equal(CtrmReadStatus.PartialSuccess, result.Status);
        Assert.Contains("Truncated after 3 pages", result.Detail);
        Assert.Equal(3, client.Calls);
        Assert.Equal(3 * PageSize, (result.Value ?? []).Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AFailedPageInsideABatchFailsTheWholeWindow()
    {
        // A short list is worse than an honest failure: one lost page would render as a producer with
        // fewer tickets, with nothing on screen to say so.
        var client = new PagingClient(totalRows: 3000) { FailAtSkip = 1000 };

        var result = await Sut(client).GetForProducerAsync(Producer, CancellationToken.None);

        Assert.False(result.Ok);
    }
}
