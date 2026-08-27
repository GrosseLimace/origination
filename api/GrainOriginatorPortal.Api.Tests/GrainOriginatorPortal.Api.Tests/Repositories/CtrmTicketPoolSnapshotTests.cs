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
/// Covers the trade-unit-wide ticket pool: what it asks CTRM for, and how it caches.
/// </summary>
/// <remarks>
/// The walk is minutes long, so the cache semantics ARE the feature. A caller that could block on a
/// build, or a failure that got cached, would take Build-a-List down for the length of a walk.
/// </remarks>
public class CtrmTicketPoolSnapshotTests
{
    private const string Producer = "TESTPRD";

    private sealed class StubClient : ICtrmGraphQlClient
    {
        private readonly CtrmReadStatus? _failWith;
        public StubClient(CtrmReadStatus? failWith = null) => _failWith = failWith;

        public bool IsConfigured { get; init; } = true;
        public List<IReadOnlyDictionary<string, object?>> Variables { get; } = [];
        public int Calls => Variables.Count;
        public TaskCompletionSource Gate { get; } = new();
        public volatile bool UseGate;
        /// <summary>Completes on the first GATED call, so a test can hold a build open at a known point.</summary>
        public TaskCompletionSource Entered { get; } = new();

        public async Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            lock (Variables)
                Variables.Add(variables as IReadOnlyDictionary<string, object?>
                    ?? variables?.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(variables))
                    ?? new Dictionary<string, object?>());
            Assert.DoesNotContain('#', document);
            if (UseGate) { Entered.TrySetResult(); await Gate.Task; }

            if (_failWith is { } status)
                return new CtrmReadResult<T> { Status = status, Detail = "stub failure" };

            var response = new CtrmTicketsResponse
            {
                Tickets = new CtrmPage<CtrmTicketDto>
                {
                    TotalCount = 1,
                    PageInfo = new CtrmPageInfo { HasNextPage = false },
                    Items = [new CtrmTicketDto { TicketNumber = "1", TicketBLDate = new DateTime(2026, 8, 1),
                        Details = [new CtrmTicketDetailDto { CustomerCode = Producer, ContractNumber = "UWW000001", TicketType = "U", TicketSequenceNumber = 1 }] }]
                }
            };
            return new CtrmReadResult<T> { Status = CtrmReadStatus.Ok, HttpStatus = 200, Value = (T)(object)response };
        }
    }

    private static IConfiguration Config(int lookbackDays = 1095, int poolMinutes = 720) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:TicketLookbackDays"] = lookbackDays.ToString(),
            ["Ctrm:TicketPoolMinutes"] = poolMinutes.ToString(),
            ["Ctrm:PageConcurrency"] = "4"
        }).Build();

    private static IServiceScopeFactory ScopeFactory(int producers)
    {
        var services = new ServiceCollection();
        var db = $"pool-app-{Guid.NewGuid()}";
        services.AddDbContext<ApplicationDbContext>(o => o.UseInMemoryDatabase(db));
        var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        for (var i = 0; i < producers; i++)
            ctx.Customers.Add(new Customer { Id = i + 1, ScoularId = i == 0 ? Producer : $"P{i:D6}", Name = $"Producer {i}", IsActive = true });
        ctx.SaveChanges();
        return provider.GetRequiredService<IServiceScopeFactory>();
    }

    private static CtrmTicketPoolSnapshot Sut(StubClient client, IConfiguration? config = null, int producers = 3)
    {
        config ??= Config();
        return new CtrmTicketPoolSnapshot(client,
            new CtrmTicketReader(client, config, new Mock<ILogger<CtrmTicketReader>>().Object),
            config, new Mock<ILogger<CtrmTicketPoolSnapshot>>().Object, ScopeFactory(producers));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task WalksEveryWindowForEveryProducerChunk()
    {
        // Three windows for a three-year lookback, one chunk for a small producer set: three requests, each
        // carrying the whole producer set and a range inside the server's cap.
        var client = new StubClient();

        var result = await Sut(client, Config(lookbackDays: 1095)).GetAsync(CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(3, client.Calls);
        Assert.Equal(3, result.Windows);
        Assert.All(client.Variables, v =>
        {
            Assert.Equal(3, Assert.IsAssignableFrom<IEnumerable<string>>(v["customerIds"]).Count());
            var from = DateTime.Parse((string)v["from"]!); var to = DateTime.Parse((string)v["to"]!);
            Assert.True((to - from).TotalDays <= CtrmQueries.MaxTicketRangeDays);
        });
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ChunksAProducerSetLargerThanTheServerCap()
    {
        // 501 producers is two chunks per window. 366 days is one window. Two requests.
        var client = new StubClient();

        var result = await Sut(client, Config(lookbackDays: 366), producers: 501).GetAsync(CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(2, client.Calls);
        Assert.Equal(501, result.Producers);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ItAsksForAllTicketsNotJustUnapplied()
    {
        // The read this replaces returns applied tickets too, and the delivery / unsettled prompts depend on
        // them. unappliedOnly would cut the walk to a fifth - and make those prompts silently wrong.
        var client = new StubClient();

        await Sut(client).GetAsync(CancellationToken.None);

        Assert.All(client.Variables, v => Assert.False(v.ContainsKey("unappliedOnly")));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ASuccessfulLoadIsCached()
    {
        var client = new StubClient();
        var sut = Sut(client);

        await sut.GetAsync(CancellationToken.None);
        await sut.GetAsync(CancellationToken.None);

        Assert.Equal(3, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AFailedLoadIsNotCachedForTheFullTtl()
    {
        // A transient failure must not empty every ticket prompt for twelve hours.
        var client = new StubClient(CtrmReadStatus.Unauthorized);
        var sut = Sut(client);

        var first = await sut.GetAsync(CancellationToken.None);
        sut.Invalidate();
        var second = await sut.GetAsync(CancellationToken.None);

        Assert.False(first.Ok);
        Assert.False(second.Ok);
        Assert.Equal(2, client.Calls);   // one attempt each: the first window fails and the walk stops
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task NoActiveProducersIsAHardFailureNotAnEmptyPool()
    {
        var client = new StubClient();

        var result = await Sut(client, producers: 0).GetAsync(CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Equal(0, client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ACallerArrivingDuringAColdBuildIsToldWarmingRatherThanWaiting()
    {
        // The walk is minutes. A request that queued behind it would hold the connection open for all of it.
        var client = new StubClient { UseGate = true };
        var sut = Sut(client);

        var building = sut.GetAsync(CancellationToken.None);
        await client.Entered.Task;

        var meanwhile = await sut.GetAsync(CancellationToken.None);
        Assert.Equal(CtrmReadStatus.Warming, meanwhile.Status);

        client.Gate.SetResult();
        Assert.True((await building).Ok);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ARebuildServesThePreviousPoolRatherThanNothing()
    {
        var client = new StubClient();
        var sut = Sut(client);
        var first = await sut.GetAsync(CancellationToken.None);
        Assert.True(first.Ok);

        // Hold the rebuild open at its first CTRM call; the caller arriving meanwhile must get the previous
        // copy, not Warming and not a wait.
        sut.MarkStale();
        client.UseGate = true;
        var rebuild = sut.GetAsync(CancellationToken.None);
        await client.Entered.Task;

        var meanwhile = await sut.GetAsync(CancellationToken.None);

        Assert.True(meanwhile.Ok);
        Assert.NotEmpty(meanwhile.Tickets);
        Assert.Contains("previous ticket pool", meanwhile.Detail);
        Assert.False(rebuild.IsCompleted);

        client.Gate.SetResult();
        Assert.True((await rebuild).Ok);
    }
}
