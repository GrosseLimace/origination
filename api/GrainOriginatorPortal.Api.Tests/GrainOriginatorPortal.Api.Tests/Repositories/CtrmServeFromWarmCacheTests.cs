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
/// A producer click answered from the warm trade-unit caches instead of waiting on CTRM.
/// </summary>
/// <remarks>
/// <para>The home page already fetches every contract and ticket for the producers in the user's trade
/// units, so a click that re-reads one of those producers live is paying 2-14 seconds for rows already in
/// memory. These tests pin the two halves of that: the click is answered from the set (no CTRM call in
/// front of the user), AND the live read still runs behind it so the per-producer cache converges - the
/// screen is never left showing only the cached copy.</para>
///
/// <para>The qualification rules matter more than the speed: a truncated set cannot say which producer
/// lost rows, an in-flight refresh has an unknowable age, and an expired ticket window is exactly what a
/// Build-a-List prompt would refuse. Each gets a test, because serving the wrong thing here shows a
/// producer someone else's idea of their book.</para>
/// </remarks>
public class CtrmServeFromWarmCacheTests
{
    private const string Member = "MEMBER1";
    private const string Outsider = "NOSET99";

    /// <summary>Answers contract reads with rows attributed to specific producers.</summary>
    private sealed class ContractClient : ICtrmGraphQlClient
    {
        private readonly IReadOnlyList<string> _setCodes;
        private readonly int _totalCountOverride;

        /// <param name="setCodes">One contract per code is returned for a customerIds read.</param>
        /// <param name="totalCountOverride">When set, a batch read always reports another page, so the
        /// reader runs to its page cap and returns PartialSuccess - the "truncated set" case.</param>
        public ContractClient(IReadOnlyList<string> setCodes, int totalCountOverride = 0)
        {
            _setCodes = setCodes;
            _totalCountOverride = totalCountOverride;
        }

        public bool IsConfigured => true;
        public List<string> Documents { get; } = [];
        public int Calls => Documents.Count;
        public int SingularCalls { get; private set; }

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            lock (Documents) Documents.Add(document);

            var map = variables?.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(variables))
                      ?? [];
            var singular = map.TryGetValue("customerId", out var one) && one is string;
            if (singular) SingularCalls++;

            var codes = singular ? [(string)one!] : _setCodes;
            var items = codes.Select(c => new CtrmContractDto
            {
                ContractId = $"PM{c}",
                ContractPrefixType = "P",
                ContractNumber = c,
                CustomerId = c,
                CropYear = DateTime.Today.Year
            }).ToList();

            var truncating = _totalCountOverride > 0 && !singular;
            var response = new CtrmContractsResponse
            {
                Contracts = new CtrmPage<CtrmContractDto>
                {
                    TotalCount = truncating ? _totalCountOverride : items.Count,
                    PageInfo = new CtrmPageInfo { HasNextPage = truncating },
                    Items = items
                }
            };

            return Task.FromResult(new CtrmReadResult<T> { Status = CtrmReadStatus.Ok, HttpStatus = 200, Value = (T)(object)response });
        }
    }

    /// <summary>Answers ticket reads with one header per code, each carrying that producer's detail row.</summary>
    private sealed class TicketClient : ICtrmGraphQlClient
    {
        private readonly IReadOnlyList<string> _setCodes;

        public TicketClient(IReadOnlyList<string> setCodes) => _setCodes = setCodes;

        public bool IsConfigured => true;
        public List<string> Documents { get; } = [];
        public int Calls => Documents.Count;

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            lock (Documents) Documents.Add(document);

            var map = variables as IReadOnlyDictionary<string, object?>
                      ?? variables?.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(variables))
                      ?? new Dictionary<string, object?>();
            var singular = map.TryGetValue("customerId", out var one) && one is string;
            var codes = singular ? [(string)one!] : _setCodes;

            var items = codes.Select((c, i) => new CtrmTicketDto
            {
                TicketPrefix = "T",
                TicketNumber = $"{1000 + i}",
                TicketSuffix = string.Empty,
                TicketBLDate = DateTime.Today.AddDays(-1),
                ProductCode = "YC",
                Details =
                [
                    new CtrmTicketDetailDto
                    {
                        TicketSequenceNumber = i + 1,
                        CustomerCode = c,
                        ContractNumber = $"U{c}",
                        TicketType = "U"
                    }
                ]
            }).ToList();

            var response = new CtrmTicketsResponse
            {
                Tickets = new CtrmPage<CtrmTicketDto>
                {
                    TotalCount = items.Count,
                    PageInfo = new CtrmPageInfo { HasNextPage = false },
                    Items = items
                }
            };

            return Task.FromResult(new CtrmReadResult<T> { Status = CtrmReadStatus.Ok, HttpStatus = 200, Value = (T)(object)response });
        }
    }

    private static IConfiguration Config(
        bool serveFromSet = true,
        int maxAgeMinutes = 15,
        int tradeUnitMinutes = 15,
        int currentWindowMinutes = 5,
        int lookbackDays = 365,
        string strategy = "customerIds",
        int maxPagesPerChunk = 100) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:TradeUnitContractMaxPagesPerChunk"] = maxPagesPerChunk.ToString(),
            ["Ctrm:ServeClickFromTradeUnitCache"] = serveFromSet.ToString(),
            ["Ctrm:ServeClickFromTradeUnitCacheMaxMinutes"] = maxAgeMinutes.ToString(),
            ["Ctrm:TradeUnitCacheMinutes"] = tradeUnitMinutes.ToString(),
            ["Ctrm:TradeUnitCurrentWindowCacheMinutes"] = currentWindowMinutes.ToString(),
            ["Ctrm:TicketLookbackDays"] = lookbackDays.ToString(),
            ["Ctrm:LiveCacheSeconds"] = "60",
            ["Ctrm:TradeUnitContractStrategy"] = strategy,
            ["Ctrm:ServerTimeoutRetryDelaySeconds"] = "0",
            ["Ctrm:InteractiveServerTimeoutRetryDelaySeconds"] = "0"
        }).Build();

    private static CtrmContractReader ContractSut(ICtrmGraphQlClient client, IConfiguration config, Func<DateTime> clock) =>
        new(client, config, new Mock<ILogger<CtrmContractReader>>().Object, clock);

    private static CtrmTicketReader TicketSut(ICtrmGraphQlClient client, IConfiguration config, Func<DateTime> clock) =>
        new(client, config, new Mock<ILogger<CtrmTicketReader>>().Object, clock);

    private static List<string> Set() => [Member, "MEMBER2", "MEMBER3"];

    // -------------------------------------------------------------------------
    // Contracts
    // -------------------------------------------------------------------------
    [Fact]
    public async Task AClickIsAnsweredFromTheWarmSetAndFilteredToThatProducer()
    {
        var now = new DateTime(2026, 8, 28, 12, 0, 0, DateTimeKind.Utc);
        var client = new ContractClient(Set());
        var sut = ContractSut(client, Config(), () => now);

        await sut.GetForProducersAsync(Set(), CancellationToken.None);
        var afterWarm = client.Calls;

        var click = await sut.GetForProducerCoreAsync(Member, CancellationToken.None);

        Assert.Equal(CtrmReadOrigin.TradeUnitCache, click.Origin);
        Assert.Single(click.Value!);
        Assert.Equal(Member, click.Value![0].CustomerId);

        // The live read runs BEHIND the answer, so the per-producer cache converges rather than the screen
        // being left on the cached copy. It is the singular filter, i.e. the cheap indexed one.
        await Task.Delay(50);
        Assert.True(client.Calls > afterWarm, "the live per-producer read was never kicked behind the cached answer");
        Assert.Equal(1, client.SingularCalls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AProducerWithNoContractsInTheSetIsServedAnEmptyListNotAMiss()
    {
        // A member with zero contracts is a real answer, and the cheapest possible click. Treating it as a
        // cache miss would make every empty producer pay a CTRM call for nothing.
        var now = new DateTime(2026, 8, 28, 12, 0, 0, DateTimeKind.Utc);
        var client = new ContractClient(["MEMBER2", "MEMBER3"]);   // Member is in the SET but has no rows
        var sut = ContractSut(client, Config(), () => now);

        await sut.GetForProducersAsync(Set(), CancellationToken.None);

        var click = await sut.GetForProducerCoreAsync(Member, CancellationToken.None);

        Assert.Equal(CtrmReadOrigin.TradeUnitCache, click.Origin);
        Assert.Empty(click.Value!);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AProducerOutsideEveryWarmSetIsReadLive()
    {
        var now = new DateTime(2026, 8, 28, 12, 0, 0, DateTimeKind.Utc);
        var client = new ContractClient(Set());
        var sut = ContractSut(client, Config(), () => now);

        await sut.GetForProducersAsync(Set(), CancellationToken.None);

        var click = await sut.GetForProducerCoreAsync(Outsider, CancellationToken.None);

        Assert.Null(click.Origin);
        Assert.Equal(1, client.SingularCalls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ASetOlderThanTheMaxAgeIsNotServed()
    {
        var now = new DateTime(2026, 8, 28, 12, 0, 0, DateTimeKind.Utc);
        var client = new ContractClient(Set());
        // Set TTL long enough that the entry is still cached, but past the click-serving ceiling.
        var sut = ContractSut(client, Config(maxAgeMinutes: 5, tradeUnitMinutes: 60), () => now);

        await sut.GetForProducersAsync(Set(), CancellationToken.None);

        now = now.AddMinutes(6);
        var click = await sut.GetForProducerCoreAsync(Member, CancellationToken.None);

        Assert.Null(click.Origin);
        Assert.Equal(1, client.SingularCalls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ATruncatedSetIsNotServed()
    {
        // PartialSuccess means a page cap was hit, so the set is an unknown subset - it cannot say whether
        // THIS producer's rows are all there. Falling through to live is the only safe answer.
        var now = new DateTime(2026, 8, 28, 12, 0, 0, DateTimeKind.Utc);
        var client = new ContractClient(Set(), totalCountOverride: 500 * 200);
        var sut = ContractSut(client, Config(maxPagesPerChunk: 2), () => now);

        var warm = await sut.GetForProducersAsync(Set(), CancellationToken.None);
        Assert.Equal(CtrmReadStatus.PartialSuccess, warm.Status);

        var click = await sut.GetForProducerCoreAsync(Member, CancellationToken.None);

        Assert.Null(click.Origin);
        Assert.Equal(1, client.SingularCalls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AFreshPerProducerEntryWinsOverTheSet()
    {
        // The per-producer read is the more precise answer: once it exists and is fresh, the set must not
        // shadow it - otherwise a click could go backwards in time after a live read had already landed.
        var now = new DateTime(2026, 8, 28, 12, 0, 0, DateTimeKind.Utc);
        var client = new ContractClient(Set());
        var sut = ContractSut(client, Config(), () => now);

        await sut.GetForProducerCoreAsync(Member, CancellationToken.None);   // live first
        await sut.GetForProducersAsync(Set(), CancellationToken.None);
        var calls = client.Calls;

        var click = await sut.GetForProducerCoreAsync(Member, CancellationToken.None);

        Assert.Null(click.Origin);                 // served from the per-producer cache, not the set
        Assert.Equal(calls, client.Calls);         // and no new call
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ServingClicksFromTheSetCanBeSwitchedOff()
    {
        var now = new DateTime(2026, 8, 28, 12, 0, 0, DateTimeKind.Utc);
        var client = new ContractClient(Set());
        var sut = ContractSut(client, Config(serveFromSet: false), () => now);

        await sut.GetForProducersAsync(Set(), CancellationToken.None);

        var click = await sut.GetForProducerCoreAsync(Member, CancellationToken.None);

        Assert.Null(click.Origin);
        Assert.Equal(1, client.SingularCalls);
    }

    // -------------------------------------------------------------------------
    // Tickets
    // -------------------------------------------------------------------------
    [Fact]
    public async Task ATicketClickIsAnsweredFromTheWarmSetAndFilteredToThatProducer()
    {
        var now = new DateTime(2026, 8, 28, 12, 0, 0, DateTimeKind.Utc);
        var client = new TicketClient(Set());
        var sut = TicketSut(client, Config(), () => now);

        await sut.GetForProducersHistoryAsync(Set(), CancellationToken.None);
        var afterWarm = client.Calls;

        var click = await sut.GetForProducerAsync(Member, CancellationToken.None);

        Assert.Equal(CtrmReadOrigin.TradeUnitCache, click.Origin);
        Assert.Single(click.Value!);
        Assert.Equal(Member, click.Value![0].Details[0].CustomerCode);

        await Task.Delay(50);
        Assert.True(client.Calls > afterWarm, "the live per-producer ticket read was never kicked behind the answer");
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ATicketSetMissingAWindowIsNotServed()
    {
        // All-or-nothing across windows: mixing a cached window with a live one would produce a list whose
        // halves describe different moments. A 3-year lookback needs all three windows cached.
        var now = new DateTime(2026, 8, 28, 12, 0, 0, DateTimeKind.Utc);
        var client = new TicketClient(Set());

        // Warm with a ONE-window lookback, then click with the three-window default.
        var warmSut = TicketSut(client, Config(lookbackDays: 365), () => now);
        await warmSut.GetForProducersHistoryAsync(Set(), CancellationToken.None);

        var clickSut = TicketSut(client, Config(lookbackDays: 1095), () => now);
        var click = await clickSut.GetForProducerAsync(Member, CancellationToken.None);

        Assert.Null(click.Origin);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AnExpiredCurrentTicketWindowIsNotServedToAClick()
    {
        // The click gets exactly the freshness a Build-a-List prompt gets: once the current window is past
        // TradeUnitCurrentWindowCacheMinutes it is refresh-eligible, so a click reads live instead.
        var now = new DateTime(2026, 8, 28, 12, 0, 0, DateTimeKind.Utc);
        var client = new TicketClient(Set());
        var sut = TicketSut(client, Config(currentWindowMinutes: 5), () => now);

        await sut.GetForProducersHistoryAsync(Set(), CancellationToken.None);

        now = now.AddMinutes(6);
        var click = await sut.GetForProducerAsync(Member, CancellationToken.None);

        Assert.Null(click.Origin);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TheTradeUnitCurrentWindowOutlivesThePerProducerTtl()
    {
        // The whole point of the separate TTL: at 60s the trade unit's full-year chunk scan re-ran every
        // minute in the background, competing with clicks. It must survive well past that.
        var now = new DateTime(2026, 8, 28, 12, 0, 0, DateTimeKind.Utc);
        var client = new TicketClient(Set());
        var sut = TicketSut(client, Config(currentWindowMinutes: 5), () => now);

        await sut.GetForProducersHistoryAsync(Set(), CancellationToken.None);
        var calls = client.Calls;

        now = now.AddSeconds(90);   // well past LiveCacheSeconds
        await sut.GetForProducersHistoryAsync(Set(), CancellationToken.None);

        Assert.Equal(calls, client.Calls);
    }

    // -------------------------------------------------------------------------
    // Registry
    // -------------------------------------------------------------------------
    [Fact]
    public void TheWarmRegistryTracksRecentSetsAndForgetsOldOnes()
    {
        var now = new DateTime(2026, 8, 28, 12, 0, 0, DateTimeKind.Utc);
        var registry = new CtrmWarmRegistry();

        registry.Touch(["A1", "B2"], now);
        registry.Touch(["C3"], now.AddMinutes(30));

        Assert.Equal(2, registry.Count);

        // Only the recently-touched set is maintained.
        var active = registry.ActiveSets(TimeSpan.FromMinutes(10), now.AddMinutes(35));
        Assert.Single(active);
        Assert.Equal(["C3"], active[0]);

        // Order-independent: the same codes in a different order are the same set, not a second one.
        registry.Touch(["B2", "A1"], now.AddMinutes(40));
        Assert.Equal(2, registry.Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void TheWarmRegistryIsCappedSoAVarietyOfSelectionsCannotGrowItForever()
    {
        var now = new DateTime(2026, 8, 28, 12, 0, 0, DateTimeKind.Utc);
        var registry = new CtrmWarmRegistry();

        for (var i = 0; i < 50; i++)
            registry.Touch([$"CODE{i:D3}"], now.AddSeconds(i));

        Assert.True(registry.Count <= 32, $"registry grew to {registry.Count}");

        // The survivors are the most recent ones.
        var active = registry.ActiveSets(TimeSpan.FromHours(1), now.AddMinutes(1));
        Assert.Contains(active, s => s[0] == "CODE049");
        Assert.DoesNotContain(active, s => s[0] == "CODE000");
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void AnEmptySetIsNeverTracked()
    {
        var registry = new CtrmWarmRegistry();

        registry.Touch([], DateTime.UtcNow);
        registry.Touch(["  ", null!], DateTime.UtcNow);

        Assert.Equal(0, registry.Count);
    }
}
