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
/// Covers the date-window snapshot: the config guard, page walking, truncation reporting and caching.
/// </summary>
/// <remarks>
/// Truncation is the focus. A capped snapshot renders identically to a producer who genuinely has no
/// contracts, so the tests here pin that it is reported rather than swallowed.
/// </remarks>
public class CtrmContractSnapshotTests
{
    /// <summary>
    /// Hands back canned pages and records how many requests were made.
    /// </summary>
    private sealed class StubClient : ICtrmGraphQlClient
    {
        private readonly Func<int, CtrmPage<CtrmContractDto>> _pageFactory;
        private readonly CtrmReadResult<object>? _failure;

        public StubClient(Func<int, CtrmPage<CtrmContractDto>> pageFactory) => _pageFactory = pageFactory;

        public StubClient(CtrmReadStatus failureStatus, string detail)
            => _failure = new CtrmReadResult<object> { Status = failureStatus, Detail = detail };

        public bool IsConfigured { get; init; } = true;
        public int Calls { get; private set; }

        /// <summary>When set, the stub blocks on this before answering, simulating a slow page walk.</summary>
        public Task? GateBeforeResponse { get; set; }

        /// <summary>Completes once the stub has been entered, so a test can be sure a build is in flight.</summary>
        public TaskCompletionSource Entered { get; } = new();

        public async Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            Calls++;
            Entered.TrySetResult();

            if (GateBeforeResponse is { } gate) await gate;

            // The WAF rejects '#' comment lines, so no query document may contain one.
            Assert.DoesNotContain('#', document);

            if (_failure is not null)
                return new CtrmReadResult<T> { Status = _failure.Status, Detail = _failure.Detail };

            var response = new CtrmContractsResponse { Contracts = _pageFactory(Calls - 1) };
            return new CtrmReadResult<T>
            {
                Status = CtrmReadStatus.Ok,
                HttpStatus = 200,
                Value = (T)(object)response
            };
        }
    }

    private static IConfiguration Config(
        string? from = "2026-01-01",
        string? to = "2026-07-30",
        int pageSize = 2,
        int maxPages = 5,
        int snapshotMinutes = 30)
    {
        var values = new Dictionary<string, string?>
        {
            ["Ctrm:PageSize"] = pageSize.ToString(),
            ["Ctrm:MaxPages"] = maxPages.ToString(),
            ["Ctrm:SnapshotMinutes"] = snapshotMinutes.ToString()
        };
        if (from is not null) values["Ctrm:ContractDateFrom"] = from;
        if (to is not null) values["Ctrm:ContractDateTo"] = to;

        return new ConfigurationBuilder().AddInMemoryCollection(values).Build();
    }

    /// <summary>The producer code every generated contract belongs to, seeded into the customer table.</summary>
    private const string KnownProducer = "TESTPROD";

    private static CtrmContractSnapshot Sut(ICtrmGraphQlClient client, IConfiguration config, bool seedProducer = true) =>
        new(client, config, new Mock<ILogger<CtrmContractSnapshot>>().Object, ScopeFactory(seedProducer));

    /// <summary>
    /// A minimal container exposing an in-memory <see cref="ApplicationDbContext"/>.
    /// </summary>
    /// <remarks>
    /// The snapshot is a singleton and resolves the customer table through a scope per load, so tests
    /// have to supply a real scope factory rather than a mock.
    /// </remarks>
    private static IServiceScopeFactory ScopeFactory(bool seedProducer)
    {
        var dbName = $"snapshot-app-{Guid.NewGuid()}";
        var services = new ServiceCollection();
        services.AddDbContext<ApplicationDbContext>(o => o.UseInMemoryDatabase(dbName));
        var provider = services.BuildServiceProvider();

        if (seedProducer)
        {
            using var scope = provider.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            db.Customers.Add(new Customer { ScoularId = KnownProducer, Name = "Test Producer", IsActive = true });
            db.SaveChanges();
        }

        return provider.GetRequiredService<IServiceScopeFactory>();
    }

    /// <summary>Builds a page of <paramref name="count"/> contracts, reporting whether more follow.</summary>
    /// <remarks>
    /// Rows are purchase contracts for <see cref="KnownProducer"/> so they survive the snapshot's
    /// retain filter — non-purchase rows and unknown producers are discarded while paging.
    /// </remarks>
    private static CtrmPage<CtrmContractDto> Page(int count, int totalCount, bool hasNext) => new()
    {
        TotalCount = totalCount,
        PageInfo = new CtrmPageInfo { HasNextPage = hasNext },
        Items = Enumerable.Range(0, count)
            .Select(i => new CtrmContractDto
            {
                ContractId = $"P{Guid.NewGuid():N}",
                ContractPrefixType = "P",
                CustomerId = KnownProducer
            })
            .ToList()
    };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task UnconfiguredClient_ReportsNotConfigured_WithoutQuerying()
    {
        var client = new StubClient(_ => Page(0, 0, false)) { IsConfigured = false };

        var result = await Sut(client, Config()).GetAsync(CancellationToken.None);

        Assert.Equal(CtrmReadStatus.NotConfigured, result.Status);
        Assert.Equal(0, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(null, "2026-07-30")]
    [InlineData("2026-01-01", null)]
    [InlineData(null, null)]
    public async Task MissingWindow_IsRefusedRatherThanDefaulted(string? from, string? to)
    {
        // Deliberately no default window. An accidental multi-year range is hundreds of sequential
        // requests, so refusing to guess reports a misconfiguration instead of stalling the screen.
        var client = new StubClient(_ => Page(1, 1, false));

        var result = await Sut(client, Config(from, to)).GetAsync(CancellationToken.None);

        Assert.Equal(CtrmReadStatus.NotConfigured, result.Status);
        Assert.Contains("ContractDateFrom", result.Detail);
        Assert.Equal(0, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task UnparseableWindow_IsRefused()
    {
        var client = new StubClient(_ => Page(1, 1, false));

        var result = await Sut(client, Config(from: "01/01/2026")).GetAsync(CancellationToken.None);

        Assert.Equal(CtrmReadStatus.NotConfigured, result.Status);
        Assert.Contains("yyyy-MM-dd", result.Detail);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task InvertedWindow_IsRefused()
    {
        var client = new StubClient(_ => Page(1, 1, false));

        var result = await Sut(client, Config(from: "2026-07-30", to: "2026-01-01")).GetAsync(CancellationToken.None);

        Assert.Equal(CtrmReadStatus.NotConfigured, result.Status);
        Assert.Contains("before", result.Detail);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task WalksEveryPageUntilHasNextPageIsFalse()
    {
        var client = new StubClient(page => Page(2, 5, hasNext: page < 2));

        var result = await Sut(client, Config(pageSize: 2)).GetAsync(CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Ok, result.Status);
        Assert.Equal(3, client.Calls);
        Assert.Equal(6, result.Contracts.Count);
        Assert.Equal(5, result.TotalCountInWindow);
        Assert.False(result.Truncated);
        Assert.Null(result.Detail);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task HittingThePageCap_IsReportedAsTruncated_NotSilentlyAcceptable()
    {
        // The whole point: a capped window must be distinguishable from an empty one.
        var client = new StubClient(_ => Page(2, 10_000, hasNext: true));

        var result = await Sut(client, Config(pageSize: 2, maxPages: 3)).GetAsync(CancellationToken.None);

        Assert.True(result.Truncated);
        Assert.Equal(3, client.Calls);
        Assert.Equal(6, result.Contracts.Count);
        Assert.Equal(10_000, result.TotalCountInWindow);
        Assert.Contains("TRUNCATED", result.Detail);
        // Still usable — callers get the rows that were fetched, plus the warning.
        Assert.True(result.Ok);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task FailureMidWalk_PropagatesTheStatusAndNamesThePage()
    {
        var client = new StubClient(CtrmReadStatus.Unauthorized, "secret expired");

        var result = await Sut(client, Config()).GetAsync(CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Unauthorized, result.Status);
        Assert.False(result.Ok);
        Assert.Contains("secret expired", result.Detail);
        Assert.Contains("page 1", result.Detail);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task SuccessfulLoad_IsCached_AndNotRefetched()
    {
        var client = new StubClient(_ => Page(1, 1, false));
        var sut = Sut(client, Config());

        await sut.GetAsync(CancellationToken.None);
        await sut.GetAsync(CancellationToken.None);
        await sut.GetAsync(CancellationToken.None);

        Assert.Equal(1, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Invalidate_ForcesARefetch()
    {
        var client = new StubClient(_ => Page(1, 1, false));
        var sut = Sut(client, Config());

        await sut.GetAsync(CancellationToken.None);
        sut.Invalidate();
        await sut.GetAsync(CancellationToken.None);

        Assert.Equal(2, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task DiscardsNonPurchaseRowsAndUnknownProducers_WhilePaging()
    {
        // This is what makes a 110k-row window affordable: rows we could never display are dropped as
        // they arrive rather than held in memory. Scanned counts everything; Contracts counts what stayed.
        var page = new CtrmPage<CtrmContractDto>
        {
            TotalCount = 4,
            PageInfo = new CtrmPageInfo { HasNextPage = false },
            Items =
            [
                new() { ContractId = "P1", ContractPrefixType = "P", CustomerId = KnownProducer },   // keep
                new() { ContractId = "S1", ContractPrefixType = "S", CustomerId = KnownProducer },   // sale
                new() { ContractId = "P2", ContractPrefixType = "P", CustomerId = "XM6229" },        // counterparty
                new() { ContractId = "P3", ContractPrefixType = "P", CustomerId = null }             // no producer
            ]
        };

        var result = await Sut(new StubClient(_ => page), Config()).GetAsync(CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal("P1", Assert.Single(result.Contracts).ContractId);
        Assert.Equal(4, result.ScannedInWindow);
        Assert.Equal(4, result.TotalCountInWindow);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task PagesAreFetchedInParallelAfterTheFirst_AndReassembledInOrder()
    {
        // Page 1 is fetched alone for its totalCount, which is what lets the rest run concurrently. At
        // ~10s per page that is the difference between a ~195s and a ~50s warm-up.
        var client = new StubClient(page => new CtrmPage<CtrmContractDto>
        {
            TotalCount = 6,
            PageInfo = new CtrmPageInfo { HasNextPage = true },
            Items = [new CtrmContractDto
            {
                ContractId = $"P{page:D3}", ContractPrefixType = "P", CustomerId = KnownProducer
            }]
        });

        var result = await Sut(client, Config(pageSize: 1, maxPages: 10)).GetAsync(CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(6, client.Calls);
        // Ordering must come from the page index, not from whichever request finished first.
        Assert.Equal(6, result.Contracts.Count);
        Assert.Equal(result.Contracts.Select(c => c.ContractId).OrderBy(id => id), result.Contracts.Select(c => c.ContractId));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AFirstPageSayingHasNextPageFalse_EndsTheWalk_EvenIfTotalCountSuggestsMore()
    {
        // hasNextPage wins over the totalCount arithmetic. They can legitimately disagree, and trusting
        // the arithmetic alone re-fetches a page the server says is not there — which, because the stub
        // (like the real API) answers anyway, silently double-counts rows.
        var client = new StubClient(_ => new CtrmPage<CtrmContractDto>
        {
            TotalCount = 500,                                     // implies many pages
            PageInfo = new CtrmPageInfo { HasNextPage = false },   // but the server says this is the last
            Items = [new CtrmContractDto { ContractId = "P1", ContractPrefixType = "P", CustomerId = KnownProducer }]
        });

        var result = await Sut(client, Config(pageSize: 1, maxPages: 10)).GetAsync(CancellationToken.None);

        Assert.Equal(1, client.Calls);
        Assert.Single(result.Contracts);
        Assert.False(result.Truncated);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task NoActiveProducers_IsAHardFailure_NotAnEmptySnapshot()
    {
        // With no producer codes every row would be discarded, producing a snapshot that loads
        // "successfully" and shows every producer zero contracts — a silent, total data loss. Better to
        // refuse and say why.
        var client = new StubClient(_ => Page(1, 1, false));

        var result = await Sut(client, Config(), seedProducer: false).GetAsync(CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Equal(CtrmReadStatus.Error, result.Status);
        Assert.Contains("No active producers", result.Detail);
        Assert.Equal(0, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ConcurrentCallers_ShareOneLoad()
    {
        var client = new StubClient(_ => Page(1, 1, false));
        var sut = Sut(client, Config());

        await Task.WhenAll(Enumerable.Range(0, 8)
            .Select(_ => sut.GetAsync(CancellationToken.None)));

        Assert.Equal(1, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ACallerArrivingDuringAColdBuild_IsToldWarming_RatherThanWaiting()
    {
        // Regression guard for a real defect. The gate used to be taken with an unbounded wait, so every
        // request that arrived during a multi-minute page walk sat on it and the producer screen showed a
        // spinner that never resolved. Waiting is never correct here — the walk outlasts any request.
        var release = new TaskCompletionSource();
        var slowClient = new StubClient(_ => Page(1, 1, false)) { GateBeforeResponse = release.Task };
        var sut = Sut(slowClient, Config());

        var firstLoad = sut.GetAsync(CancellationToken.None);
        // Give the first call time to take the gate and block inside the client.
        await slowClient.Entered.Task;

        var duringBuild = await sut.GetAsync(CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Warming, duringBuild.Status);
        Assert.False(duringBuild.Ok);
        Assert.Contains("still being built", duringBuild.Detail);

        release.SetResult();
        Assert.True((await firstLoad).Ok);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ARebuildServesThePreviousSnapshot_RatherThanNothing()
    {
        // Once something is cached, a caller arriving mid-rebuild gets the stale copy: out-of-date
        // contracts are more useful than an empty screen, and the rebuild replaces them shortly.
        var release = new TaskCompletionSource();
        var client = new StubClient(_ => Page(2, 2, false));
        var sut = Sut(client, Config(snapshotMinutes: 1));

        var first = await sut.GetAsync(CancellationToken.None);
        Assert.Equal(2, first.Contracts.Count);

        // Expire the cache, then start a rebuild that stalls inside the client.
        sut.MarkStale();
        client.GateBeforeResponse = release.Task;
        var rebuild = sut.GetAsync(CancellationToken.None);
        await client.Entered.Task;

        var duringRebuild = await sut.GetAsync(CancellationToken.None);

        Assert.True(duringRebuild.Ok);
        Assert.Equal(2, duringRebuild.Contracts.Count);
        Assert.Contains("previous snapshot", duringRebuild.Detail);

        release.SetResult();
        await rebuild;
    }
}
