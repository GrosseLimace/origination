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
/// Covers how one ticket window is paged: concurrently, and without ever losing a row.
/// </summary>
/// <remarks>
/// This replaced a sequential loop that cost 13.3s on a producer with 821 tickets (measured 2026-08-27).
/// Both properties matter and neither is visible if it regresses - a serial pump is merely slow, and a pump
/// that trusts <c>totalCount</c> over <c>hasNextPage</c> silently truncates a producer's ticket history.
/// </remarks>
[Collection("CtrmThrottle")]
public class CtrmTicketPagingTests
{
    private const string Producer = "TESTPRD";
    private const int PageSize = 500;

    /// <summary>Serves a fixed number of ticket pages and records how the pump asked for them.</summary>
    private sealed class PagingClient : ICtrmGraphQlClient
    {
        private readonly int _totalRows;
        private readonly int? _reportTotalCount;
        private int _inFlight;

        /// <param name="totalRows">Rows actually available.</param>
        /// <param name="reportTotalCount">What totalCount claims, when it should disagree with reality.</param>
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
        public bool HoldPagesAfterFirst { get; init; }

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
                if (HoldPagesAfterFirst && skip > 0) await Gate.Task;

                var remaining = Math.Max(0, _totalRows - skip);
                var count = Math.Min(PageSize, remaining);

                var response = new CtrmTicketsResponse
                {
                    Tickets = new CtrmPage<CtrmTicketDto>
                    {
                        TotalCount = _reportTotalCount ?? _totalRows,
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

    private static IConfiguration Config(int? interactivePageConcurrency = null) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:TicketLookbackDays"] = "365",          // one window, so the test is about paging only
            ["Ctrm:LiveCacheSeconds"] = "60",
            ["Ctrm:BackgroundMaxDeferSeconds"] = "0",
            ["Ctrm:ServerTimeoutRetryDelaySeconds"] = "0",
            ["Ctrm:InteractiveServerTimeoutRetryDelaySeconds"] = "0",
            ["Ctrm:InteractivePageConcurrency"] = interactivePageConcurrency?.ToString()
        }).Build();

    private static CtrmTicketReader Sut(ICtrmGraphQlClient client, IConfiguration? config = null) =>
        new(client, config ?? Config(), new Mock<ILogger<CtrmTicketReader>>().Object);

    public CtrmTicketPagingTests() => CtrmTradeUnitThrottle.ResetForTests();

    // -------------------------------------------------------------------------
    [Fact]
    public async Task EveryRowComesBackAcrossPages()
    {
        // 1,300 rows is three pages. Losing the tail would understate a producer's deliveries.
        var client = new PagingClient(totalRows: 1300);

        var result = await Sut(client).GetForProducerAsync(Producer, CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(1300, (result.Value ?? []).Count);
        Assert.Equal([0, 500, 1000], client.Skips.OrderBy(x => x));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task PagesAfterTheFirstAreFetchedConcurrently()
    {
        // The whole point of the change. Sequentially this producer cost one round trip per page.
        var client = new PagingClient(totalRows: 2000) { HoldPagesAfterFirst = true };
        var sut = Sut(client);

        var read = sut.GetForProducerAsync(Producer, CancellationToken.None);

        // Page one completes, then pages two-to-four should all be open at the same time.
        while (client.Calls < 4) await Task.Delay(10);
        Assert.Equal(3, client.PeakInFlight);
        Assert.False(read.IsCompleted);

        client.Gate.SetResult();
        var result = await read;
        Assert.True(result.Ok);
        Assert.Equal(2000, (result.Value ?? []).Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AnUnderReportedTotalCountStillYieldsEveryRow()
    {
        // totalCount and hasNextPage can disagree. hasNextPage wins, so the pump keeps going.
        var client = new PagingClient(totalRows: 1500, reportTotalCount: 500);

        var result = await Sut(client).GetForProducerAsync(Producer, CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(1500, (result.Value ?? []).Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AnOverReportedTotalCountDoesNotSpendRequestsOnEmptyPages()
    {
        // The inverse: a count that overstates must not send the pump chasing pages that do not exist.
        var client = new PagingClient(totalRows: 600, reportTotalCount: 5000);

        var result = await Sut(client).GetForProducerAsync(Producer, CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(600, (result.Value ?? []).Count);
        Assert.True(client.Calls <= 10, $"{client.Calls} requests for a 600-row window - the count was trusted over hasNextPage");
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
    public async Task InteractivePagesAreBoundedByTheConfiguredConcurrency()
    {
        // A nine-page window across three windows is twenty-seven simultaneous requests for one click, and
        // the gateway was measured degrading at nine-way fan-out - so unbounded pages slow each other down.
        var client = new PagingClient(totalRows: 2000) { HoldPagesAfterFirst = true };
        var sut = Sut(client, Config(interactivePageConcurrency: 2));

        var read = sut.GetForProducerAsync(Producer, CancellationToken.None);

        // Page one, then at most two of the remaining three in flight together.
        while (client.Calls < 3) await Task.Delay(10);
        await Task.Delay(150);
        Assert.Equal(2, client.PeakInFlight);
        Assert.False(read.IsCompleted);

        client.Gate.SetResult();
        var result = await read;
        Assert.True(result.Ok);
        Assert.Equal(2000, (result.Value ?? []).Count);
    }
}
