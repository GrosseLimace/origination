// System namespaces
using System.Globalization;

// Third-party namespaces
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// The <c>tradeUnit</c> strategy: the trade-unit-wide contract read made as one windowed
/// <c>contracts(tradeUnit:)</c> read per selected unit, kept only for roster producers. Measured 2026-10-12
/// at 7-10 s / 6 pages for a 587-producer unit against 52-70 s / 59 batched requests. These tests pin the
/// rule that makes it a different answer from the walk - a producer is listed when they are IN the unit
/// AND the contract is TAGGED to the unit - and the plumbing that keeps every caller on one cache entry.
/// </summary>
public class CtrmContractReaderTradeUnitTests
{
    /// <summary>
    /// Answers the trade-unit document from a per-unit table of contracts, the singular per-producer
    /// document from the union of every unit (a producer's full book), and fails any aliased document so
    /// a fallback to the walk is visible without being modelled.
    /// </summary>
    private sealed class UnitClient : ICtrmGraphQlClient
    {
        public bool IsConfigured => true;
        public List<(string Document, Dictionary<string, object?> Variables)> Calls { get; } = [];
        public Dictionary<string, List<CtrmContractDto>> ByUnit { get; } = new(StringComparer.OrdinalIgnoreCase);
        public HashSet<string> FailUnits { get; } = new(StringComparer.OrdinalIgnoreCase);

        public int TradeUnitCalls => Calls.Count(c => c.Document == CtrmQueries.ContractsByTradeUnit);
        public int SingularCalls => Calls.Count(c => c.Document == CtrmQueries.ContractsByCustomerCore);
        public int AliasedCalls => Calls.Count(c => c.Document.StartsWith("query {", StringComparison.Ordinal));
        public IEnumerable<Dictionary<string, object?>> TradeUnitVariables =>
            Calls.Where(c => c.Document == CtrmQueries.ContractsByTradeUnit).Select(c => c.Variables);

        public void Add(string unit, string producer, params string[] contractIds)
        {
            if (!ByUnit.TryGetValue(unit, out var list)) ByUnit[unit] = list = [];
            list.AddRange(contractIds.Select(id => new CtrmContractDto
            {
                ContractId = id, ContractPrefixType = "P", CustomerId = producer, TradeUnit = unit, CropYear = 2025
            }));
        }

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            var vars = variables?.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(variables)) ?? [];
            lock (Calls) Calls.Add((document, vars));
            Assert.DoesNotContain('#', document);

            if (document == CtrmQueries.ContractsByTradeUnit)
            {
                var unit = (string)vars["tradeUnit"]!;
                if (FailUnits.Contains(unit))
                    return Task.FromResult(new CtrmReadResult<T> { Status = CtrmReadStatus.Error, HttpStatus = 500, Detail = "stub failure" });
                var all = ByUnit.TryGetValue(unit, out var rows) ? rows : [];
                return Task.FromResult(Page<T>(all, Convert.ToInt32(vars["skip"]), Convert.ToInt32(vars["take"])));
            }

            if (document == CtrmQueries.ContractsByCustomerCore)
            {
                var code = (string)vars["customerId"]!;
                var all = ByUnit.Values.SelectMany(r => r).Where(r => r.CustomerId == code).ToList();
                return Task.FromResult(Page<T>(all, Convert.ToInt32(vars["skip"]), Convert.ToInt32(vars["take"])));
            }

            // Any other document is the aliased walk - not modelled here, only detected.
            return Task.FromResult(new CtrmReadResult<T> { Status = CtrmReadStatus.Error, HttpStatus = 500, Detail = "stub: aliased walk" });
        }

        private static CtrmReadResult<T> Page<T>(List<CtrmContractDto> all, int skip, int take)
        {
            var items = all.Skip(skip).Take(take).ToList();
            var response = new CtrmContractsResponse
            {
                Contracts = new CtrmPage<CtrmContractDto>
                {
                    TotalCount = all.Count, Items = items,
                    PageInfo = new CtrmPageInfo { Skip = skip, Take = take, HasNextPage = skip + items.Count < all.Count }
                }
            };
            return new CtrmReadResult<T> { Status = CtrmReadStatus.Ok, HttpStatus = 200, Value = (T)(object)response };
        }
    }

    private static IConfiguration Config(string strategy = "tradeUnit", int windowYears = 3, int pageConcurrency = 4, int cacheMinutes = 15) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:TradeUnitContractStrategy"] = strategy,
            ["Ctrm:TradeUnitReadWindowYears"] = windowYears.ToString(CultureInfo.InvariantCulture),
            ["Ctrm:TradeUnitReadPageConcurrency"] = pageConcurrency.ToString(CultureInfo.InvariantCulture),
            ["Ctrm:TradeUnitCacheMinutes"] = cacheMinutes.ToString(CultureInfo.InvariantCulture),
            ["Ctrm:TradeUnitContractBatchConcurrency"] = "4",
            ["Ctrm:ServeClickFromTradeUnitCache"] = "true",
            ["Ctrm:LiveCacheSeconds"] = "60",
            ["Ctrm:ServerTimeoutRetries"] = "0",
            ["Ctrm:ServerTimeoutRetryDelaySeconds"] = "0"
        }).Build();

    private static readonly DateTime Today = new(2026, 10, 12, 15, 0, 0, DateTimeKind.Utc);

    private static CtrmContractReader Sut(ICtrmGraphQlClient client, IConfiguration? config = null, Func<DateTime>? utcNow = null) =>
        new(client, config ?? Config(), new Mock<ILogger<CtrmContractReader>>().Object, utcNow ?? (() => Today));

    private static HashSet<string> Ids(CtrmReadResult<List<CtrmContractDto>> read) =>
        [.. read.Value!.Select(c => c.ContractId!)];

    // -------------------------------------------------------------------------------------------------
    // The rule: in the unit AND tagged to the unit.

    [Fact]
    public async Task ReadsTheUnitOnce_KeepsRosterProducersOnly_AndNeverReadsByProducer()
    {
        var client = new UnitClient();
        client.Add("2190", "ALPHA", "A-1", "A-2");
        client.Add("2190", "BRAVO", "B-1");
        client.Add("2190", "OFFROSTER", "X-1");                      // on the unit's book, not on our roster

        var read = await Sut(client).GetForProducersAsync(["ALPHA", "BRAVO", "CHARLIE"], ["2190"], CancellationToken.None);

        Assert.True(read.Ok, read.Detail);
        Assert.Equal(["A-1", "A-2", "B-1"], Ids(read));
        Assert.Equal(1, client.TradeUnitCalls);
        Assert.Equal(0, client.SingularCalls);
        Assert.Equal(0, client.AliasedCalls);
    }

    [Fact]
    public async Task ARosterProducersContractTaggedToAnotherUnit_IsNotReturned()
    {
        var client = new UnitClient();
        client.Add("2190", "ALPHA", "A-1");
        client.Add("2191", "ALPHA", "A-2");                           // same producer, other unit's tag

        var read = await Sut(client).GetForProducersAsync(["ALPHA"], ["2190"], CancellationToken.None);

        Assert.Equal(["A-1"], Ids(read));
    }

    [Fact]
    public async Task EverySelectedUnit_IsRead_AndTheResultsAreMerged()
    {
        var client = new UnitClient();
        client.Add("2190", "ALPHA", "A-1");
        client.Add("2191", "ALPHA", "A-2");
        client.Add("2191", "BRAVO", "B-1");

        var read = await Sut(client).GetForProducersAsync(["ALPHA", "BRAVO"], ["2191", "2190"], CancellationToken.None);

        Assert.Equal(["A-1", "A-2", "B-1"], Ids(read));
        Assert.Equal(2, client.TradeUnitCalls);
    }

    [Fact]
    public async Task PagesBeyondTheFirst_AreFetched_AndNothingIsDuplicated()
    {
        var client = new UnitClient();
        client.Add("2190", "ALPHA", [.. Enumerable.Range(0, 1200).Select(i => $"A-{i}")]);

        var read = await Sut(client).GetForProducersAsync(["ALPHA"], ["2190"], CancellationToken.None);

        Assert.Equal(1200, read.Value!.Count);
        Assert.Equal(1200, Ids(read).Count);
        Assert.Equal(3, client.TradeUnitCalls);                       // 500 + 500 + 200
        Assert.Equal([0, 500, 1000], client.TradeUnitVariables.Select(v => Convert.ToInt32(v["skip"])).Order());
    }

    [Fact]
    public async Task TheWindow_IsTheConfiguredYearsBack_AndAYearForward()
    {
        var client = new UnitClient();
        client.Add("2190", "ALPHA", "A-1");

        await Sut(client, Config(windowYears: 3)).GetForProducersAsync(["ALPHA"], ["2190"], CancellationToken.None);

        var vars = client.TradeUnitVariables.Single();
        Assert.Equal("2023-10-12", vars["from"]);
        Assert.Equal("2027-10-12", vars["to"]);
        Assert.Equal("P", vars["prefix"]);
    }

    // -------------------------------------------------------------------------------------------------
    // Failure is whole-read failure, never a shorter list.

    [Fact]
    public async Task AFailedPage_FailsTheWholeRead_WithAnEmptyValue()
    {
        var client = new UnitClient();
        client.Add("2190", "ALPHA", "A-1");
        client.Add("2191", "BRAVO", "B-1");
        client.FailUnits.Add("2191");

        var read = await Sut(client).GetForProducersAsync(["ALPHA", "BRAVO"], ["2190", "2191"], CancellationToken.None);

        Assert.False(read.Ok);
        Assert.Empty(read.Value!);
        Assert.Contains("2191", read.Detail);
    }

    // -------------------------------------------------------------------------------------------------
    // Plumbing: one cache entry per set whoever asks, and the units survive a codes-only refresh.

    [Fact]
    public async Task ACallByCodesAlone_WithNoUnitsKnown_FallsBackToTheWalk_NotToAGuess()
    {
        var client = new UnitClient();
        client.Add("2190", "ALPHA", "A-1");

        var read = await Sut(client).GetForProducersAsync(["ALPHA"], CancellationToken.None);

        Assert.Equal(0, client.TradeUnitCalls);
        Assert.True(client.AliasedCalls > 0);
        Assert.False(read.Ok);                                        // the stub fails the walk; the point is which read was sent
    }

    [Fact]
    public async Task ACallByCodesAlone_AfterATradeUnitLoad_SharesTheEntry_AndRefreshesByTradeUnit()
    {
        var client = new UnitClient();
        client.Add("2190", "ALPHA", "A-1");
        var clock = Today;
        var sut = Sut(client, Config(cacheMinutes: 1), () => clock);

        var first = await sut.GetForProducersAsync(["ALPHA"], ["2190"], CancellationToken.None);
        var warm = await sut.GetForProducersAsync(["ALPHA"], CancellationToken.None);     // keep-warm / tickets ask by codes
        Assert.Same(first, warm);                                                          // same cache entry, no new read
        Assert.Equal(1, client.TradeUnitCalls);

        clock = Today.AddMinutes(2);                                                       // past the TTL: stale-while-revalidate
        var stale = await sut.GetForProducersAsync(["ALPHA"], CancellationToken.None);
        Assert.Same(first, stale);

        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (client.TradeUnitCalls < 2 && DateTime.UtcNow < deadline) await Task.Delay(10);

        Assert.Equal(2, client.TradeUnitCalls);                                            // the refresh read by trade unit
        Assert.Equal(0, client.AliasedCalls);
    }

    // -------------------------------------------------------------------------------------------------
    // The producer's own page is untouched: it shows every contract they hold, from a live read.

    [Fact]
    public async Task AProducerClick_IsNotServedFromASetBuiltByTradeUnit_AndShowsTheWholeBook()
    {
        var client = new UnitClient();
        client.Add("2190", "ALPHA", "A-1");
        client.Add("2191", "ALPHA", "A-2");
        var sut = Sut(client);

        await sut.GetForProducersAsync(["ALPHA"], ["2190"], CancellationToken.None);       // the home-page load
        var click = await sut.GetForProducerCoreAsync("ALPHA", CancellationToken.None);

        Assert.Null(click.Origin);                                                         // live, not TradeUnitCache
        Assert.Equal(1, client.SingularCalls);
        Assert.Equal(["A-1", "A-2"], Ids(click));
    }

    [Fact]
    public async Task UnderTheAliasedStrategy_TheUnitsAreIgnored_AndAClickIsStillServedFromTheSet()
    {
        var client = new UnitClient();
        client.Add("2190", "ALPHA", "A-1");

        var read = await Sut(client, Config(strategy: "aliased")).GetForProducersAsync(["ALPHA"], ["2190"], CancellationToken.None);

        Assert.Equal(0, client.TradeUnitCalls);
        Assert.True(client.AliasedCalls > 0);
        Assert.False(read.Ok);                                        // the stub fails the walk; nothing about this test needs its data
    }
}
