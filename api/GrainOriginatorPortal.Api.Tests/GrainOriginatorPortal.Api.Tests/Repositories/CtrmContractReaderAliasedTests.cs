// System namespaces
using System.Text.Json;
using System.Text.RegularExpressions;

// Third-party namespaces
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// The aliased trade-unit contract strategy: several producers per HTTP request as GraphQL aliases.
/// Measured 2026-09-24 at 15 s / 30 requests for a 587-producer unit against 62 s / 587 requests for
/// one-producer-per-call, with the identical contract set. These tests pin the properties that made it
/// safe to ship: identical data to the per-producer walk, whole-read failure rather than a silently
/// shorter list, the retry stepping down to singular aliases, and the paged top-up for a producer that
/// overflows one page.
/// </summary>
public class CtrmContractReaderAliasedTests
{
    /// <summary>
    /// Answers the aliased document by parsing the alias filters out of it, and the singular paged
    /// document by its variables, so both strategies can be run against the same deterministic data:
    /// producer P000123 has (123 % 7) + 1 contracts, ids "P000123-0" upward.
    /// </summary>
    private sealed class AliasClient : ICtrmGraphQlClient
    {
        private static readonly Regex Alias = new(@"a(\d+): contracts\(skip: 0, take: (\d+), (customerIds: (\[[^\]]*\])|customerId: (""[^""]*""))", RegexOptions.Compiled);

        public bool IsConfigured { get; init; } = true;
        public List<string> Documents { get; } = [];
        public int Calls => Documents.Count;
        public int AliasedCalls => Documents.Count(d => d.StartsWith("query {"));
        public int SingularPagedCalls => Documents.Count(d => d == CtrmQueries.ContractsByCustomerCore);

        /// <summary>Codes whose batch fails while the request still uses two-code lists.</summary>
        public HashSet<string> FailWhilePaired { get; } = new(StringComparer.OrdinalIgnoreCase);
        /// <summary>Codes whose batch fails on every aliased attempt, paired or singular.</summary>
        public HashSet<string> FailAlways { get; } = new(StringComparer.OrdinalIgnoreCase);
        /// <summary>Codes whose batch comes back as data-plus-errors (PartialSuccess) on every aliased attempt.</summary>
        public HashSet<string> PartialAlways { get; } = new(StringComparer.OrdinalIgnoreCase);
        /// <summary>Codes given more contracts than one page holds, so their alias reports hasNextPage.</summary>
        public Dictionary<string, int> Oversized { get; } = new(StringComparer.OrdinalIgnoreCase);
        /// <summary>Codes whose batch answers the server timeout (HC0045) on its FIRST aliased attempt only -
        /// the cold plan compile - and succeeds on any later attempt, as the server's cache does.</summary>
        public HashSet<string> TimeoutOnce { get; } = new(StringComparer.OrdinalIgnoreCase);
        /// <summary>Codes whose batch answers HC0045 on every aliased attempt.</summary>
        public HashSet<string> TimeoutAlways { get; } = new(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> _timedOut = new(StringComparer.OrdinalIgnoreCase);

        public static int ContractsFor(string code) =>
            (int.Parse(code[1..]) % 7) + 1;

        private int ContractCount(string code) => Oversized.TryGetValue(code, out var n) ? n : ContractsFor(code);

        private static IEnumerable<CtrmContractDto> Rows(string code, int skip, int count) =>
            Enumerable.Range(skip, count).Select(i => new CtrmContractDto
            {
                ContractId = $"{code}-{i}", ContractPrefixType = "P", CustomerId = code, CropYear = 2025
            });

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            lock (Documents) Documents.Add(document);
            Assert.DoesNotContain('#', document);

            if (document == CtrmQueries.ContractsByCustomerCore)
                return Task.FromResult(Singular<T>(variables!));

            var matches = Alias.Matches(document);
            Assert.NotEmpty(matches);
            var pages = new Dictionary<string, CtrmPage<CtrmContractDto>>();
            var paired = false;
            var batchCodes = new List<string>();
            foreach (System.Text.RegularExpressions.Match m in matches)
            {
                var take = int.Parse(m.Groups[2].Value);
                List<string> codes;
                if (m.Groups[4].Success) { codes = JsonSerializer.Deserialize<List<string>>(m.Groups[4].Value)!; paired = codes.Count > 1; }
                else codes = [JsonSerializer.Deserialize<string>(m.Groups[5].Value)!];
                batchCodes.AddRange(codes);
                var items = codes.SelectMany(c => Rows(c, 0, Math.Min(take, ContractCount(c)))).ToList();
                var total = codes.Sum(ContractCount);
                pages[$"a{m.Groups[1].Value}"] = new CtrmPage<CtrmContractDto>
                {
                    TotalCount = total, Items = items,
                    PageInfo = new CtrmPageInfo { Skip = 0, Take = take, HasNextPage = total > take }
                };
            }

            if (batchCodes.Any(FailAlways.Contains) || (paired && batchCodes.Any(FailWhilePaired.Contains)))
                return Task.FromResult(new CtrmReadResult<T> { Status = CtrmReadStatus.Throttled, HttpStatus = 429, Detail = "stub 429" });
            var coldCode = batchCodes.FirstOrDefault(c => TimeoutOnce.Contains(c) && !_timedOut.Contains(c));
            if (coldCode is not null) lock (_timedOut) _timedOut.Add(coldCode);
            if (coldCode is not null || batchCodes.Any(TimeoutAlways.Contains))
                return Task.FromResult(new CtrmReadResult<T>
                {
                    Status = CtrmReadStatus.QueryError, HttpStatus = 400, ErrorCode = CtrmServerTimeoutRetry.ServerTimeoutCode,
                    Detail = "stub: The request exceeded the configured timeout of `00:00:30`."
                });
            if (batchCodes.Any(PartialAlways.Contains))
                return Task.FromResult(new CtrmReadResult<T> { Status = CtrmReadStatus.PartialSuccess, HttpStatus = 200, Detail = "stub partial", Value = (T)(object)pages });
            return Task.FromResult(new CtrmReadResult<T> { Status = CtrmReadStatus.Ok, HttpStatus = 200, Value = (T)(object)pages });
        }

        private CtrmReadResult<T> Singular<T>(object variables)
        {
            var props = variables.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(variables));
            var code = (string)props["customerId"]!;
            var skip = Convert.ToInt32(props["skip"]);
            var take = Convert.ToInt32(props["take"]);
            var total = ContractCount(code);
            var count = Math.Max(0, Math.Min(take, total - skip));
            var response = new CtrmContractsResponse
            {
                Contracts = new CtrmPage<CtrmContractDto>
                {
                    TotalCount = total, Items = Rows(code, skip, count).ToList(),
                    PageInfo = new CtrmPageInfo { Skip = skip, Take = take, HasNextPage = skip + count < total }
                }
            };
            return new CtrmReadResult<T> { Status = CtrmReadStatus.Ok, HttpStatus = 200, Value = (T)(object)response };
        }
    }

    private static IConfiguration Config(string strategy = "aliased", int aliasCount = 10, int codesPerAlias = 2, int concurrency = 16, int serverTimeoutRetries = 0) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:TradeUnitContractStrategy"] = strategy,
            ["Ctrm:TradeUnitAliasCount"] = aliasCount.ToString(),
            ["Ctrm:TradeUnitAliasCodesPerAlias"] = codesPerAlias.ToString(),
            ["Ctrm:TradeUnitContractBatchConcurrency"] = concurrency.ToString(),
            ["Ctrm:TradeUnitPerProducerConcurrency"] = "6",
            ["Ctrm:LiveCacheSeconds"] = "60",
            ["Ctrm:ServerTimeoutRetries"] = serverTimeoutRetries.ToString(),
            ["Ctrm:ServerTimeoutRetryDelaySeconds"] = "0"
        }).Build();

    private static CtrmContractReader Sut(ICtrmGraphQlClient client, IConfiguration? config = null) =>
        new(client, config ?? Config(), new Mock<ILogger<CtrmContractReader>>().Object);

    private static List<string> Codes(int count) => [.. Enumerable.Range(0, count).Select(i => $"P{i:D6}")];

    private static HashSet<string> ExpectedIds(IEnumerable<string> codes) =>
        [.. codes.SelectMany(c => Enumerable.Range(0, AliasClient.ContractsFor(c)).Select(i => $"{c}-{i}"))];

    // -------------------------------------------------------------------------------------------------
    // The reason it exists: far fewer requests, identical data.

    [Fact]
    public async Task TwentyProducersPerRequest_ReturnsEveryContractIn30Requests()
    {
        var client = new AliasClient();
        var codes = Codes(587);

        var read = await Sut(client).GetForProducersAsync(codes, CancellationToken.None);

        Assert.True(read.Ok, read.Detail);
        Assert.Equal(30, client.AliasedCalls);                       // ceil(587 / 20)
        Assert.Equal(0, client.SingularPagedCalls);                  // nothing overflowed a page
        Assert.Equal(ExpectedIds(codes), read.Value!.Select(c => c.ContractId).ToHashSet());
    }

    [Fact]
    public async Task ReturnsTheIdenticalContractSetAsThePerProducerWalk()
    {
        var codes = Codes(123);
        var aliased = await Sut(new AliasClient()).GetForProducersAsync(codes, CancellationToken.None);
        var perProducer = await Sut(new AliasClient(), Config(strategy: "perProducer")).GetForProducersAsync(codes, CancellationToken.None);

        Assert.True(aliased.Ok && perProducer.Ok);
        Assert.Equal(
            perProducer.Value!.Select(c => c.ContractId).OrderBy(x => x),
            aliased.Value!.Select(c => c.ContractId).OrderBy(x => x));
        Assert.Equal(perProducer.Value!.Count, aliased.Value!.Count);  // no duplicates hiding behind a set compare
    }

    // -------------------------------------------------------------------------------------------------
    // Failure: retry steps down to singular aliases; a second failure fails the WHOLE read.

    [Fact]
    public async Task BatchFailingWhilePaired_IsRetriedOnSingularAliases_AndSucceeds()
    {
        var client = new AliasClient();
        client.FailWhilePaired.Add("P000005");                       // its batch 429s while it is in a two-code list
        var codes = Codes(40);                                       // two batches of 20

        var read = await Sut(client).GetForProducersAsync(codes, CancellationToken.None);

        Assert.True(read.Ok, read.Detail);
        Assert.Equal(3, client.AliasedCalls);                        // 2 batches + 1 singular retry
        Assert.Equal(ExpectedIds(codes), read.Value!.Select(c => c.ContractId).ToHashSet());
    }

    [Fact]
    public async Task BatchFailingTwice_FailsTheWholeRead_WithAnEmptyValue()
    {
        var client = new AliasClient();
        client.FailAlways.Add("P000021");
        var codes = Codes(40);

        var read = await Sut(client).GetForProducersAsync(codes, CancellationToken.None);

        Assert.False(read.Ok);
        Assert.Equal(CtrmReadStatus.Throttled, read.Status);
        Assert.Empty(read.Value ?? []);                              // never the 20 producers that did succeed
        Assert.Contains("batched request", read.Detail);
        Assert.Equal(3, client.AliasedCalls);                        // the good batch once, the bad one twice
    }

    // -------------------------------------------------------------------------------------------------
    // Load-shedding (2026-09-28): once a batch has failed twice the read is doomed, so stop sending.

    [Fact]
    public async Task OnceABatchHasFailedTwice_TheRemainingBatchesAreNotSent()
    {
        // The read is going to fail whatever the other batches return, and every further request only
        // queues another query the server will run to completion after timing out. Concurrency 1 so the
        // batches run in order and the request count is exact.
        var client = new AliasClient();
        client.FailAlways.Add("P000001");                            // in the first batch
        var codes = Codes(100);                                      // five batches of 20

        var read = await Sut(client, Config(concurrency: 1)).GetForProducersAsync(codes, CancellationToken.None);

        Assert.False(read.Ok);
        Assert.Equal(CtrmReadStatus.Throttled, read.Status);
        Assert.Equal(2, client.AliasedCalls);                        // the doomed batch paired, then singular - nothing else
        Assert.Contains("4 batch(es) not sent", read.Detail);
        Assert.Empty(read.Value ?? []);
    }

    [Fact]
    public async Task ABatchThatRecoversOnSingularAliases_DoesNotStopTheOthers()
    {
        // The list-plan regression the singular retry exists for must not be mistaken for a doomed read.
        var client = new AliasClient();
        client.FailWhilePaired.Add("P000001");
        var codes = Codes(100);

        var read = await Sut(client, Config(concurrency: 1)).GetForProducersAsync(codes, CancellationToken.None);

        Assert.True(read.Ok, read.Detail);
        Assert.Equal(6, client.AliasedCalls);                        // five batches + one singular retry
        Assert.Equal(ExpectedIds(codes), read.Value!.Select(c => c.ContractId).ToHashSet());
    }

    // -------------------------------------------------------------------------------------------------
    // Server timeout (2026-09-29): a cold batch is re-sent once after the delay and read from the server's
    // cache; the singular re-shape does not spend a second delayed retry.

    [Fact]
    public async Task ABatchTheServerTimedOutOnce_IsReSentAndCompletesTheWalk_WithoutTheSingularReshape()
    {
        // The go-live case: a fresh connection pays the plan compile, the gateway answers HC0045 at ~31 s,
        // finishes the query anyway and caches it. One delayed re-send of the SAME paired batch gets the
        // cached answer. No singular retry, no failure, every contract present.
        var client = new AliasClient();
        client.TimeoutOnce.Add("P000021");                           // in the second batch of two
        var codes = Codes(40);

        var read = await Sut(client, Config(serverTimeoutRetries: 1)).GetForProducersAsync(codes, CancellationToken.None);

        Assert.True(read.Ok, read.Detail);
        Assert.Equal(3, client.AliasedCalls);                        // 2 batches + the one delayed re-send
        Assert.All(client.Documents.Where(d => d.StartsWith("query {")), d => Assert.Contains("customerIds:", d)); // all paired - never stepped down
        Assert.Equal(ExpectedIds(codes), read.Value!.Select(c => c.ContractId).ToHashSet());
    }

    [Fact]
    public async Task ABatchThatKeepsTimingOut_SpendsOneDelayedRetry_NotOnePerShape()
    {
        // Paired attempt -> delayed re-send -> singular re-shape sent ONCE -> read fails and the walk stops.
        // Three requests for the doomed batch, not four: the singular shape exists for the list-plan
        // failure, and giving it its own delayed retry would double the time a doomed read takes to fail.
        var client = new AliasClient();
        client.TimeoutAlways.Add("P000001");                         // in the first batch
        var codes = Codes(100);                                      // five batches of 20

        var read = await Sut(client, Config(concurrency: 1, serverTimeoutRetries: 1)).GetForProducersAsync(codes, CancellationToken.None);

        Assert.False(read.Ok);
        Assert.Equal(CtrmServerTimeoutRetry.ServerTimeoutCode, read.ErrorCode);
        Assert.Equal(3, client.AliasedCalls);                        // paired, paired again, singular once
        Assert.Contains("4 batch(es) not sent", read.Detail);
        Assert.Empty(read.Value ?? []);
    }

    [Fact]
    public async Task PartialAliasResult_IsAFailure_NotAShorterList()
    {
        var client = new AliasClient();
        client.PartialAlways.Add("P000003");
        var codes = Codes(20);                                       // a single batch

        var read = await Sut(client).GetForProducersAsync(codes, CancellationToken.None);

        Assert.False(read.Ok);
        Assert.Equal(CtrmReadStatus.QueryError, read.Status);
        Assert.Empty(read.Value ?? []);
        Assert.Contains("errored", read.Detail);
    }

    // -------------------------------------------------------------------------------------------------
    // Correctness does not depend on the page size.

    [Fact]
    public async Task AliasReportingASecondPage_IsToppedUpWithThePagedRead()
    {
        var client = new AliasClient();
        client.Oversized["P000007"] = 1234;                          // > 500: two more pages behind that alias
        var codes = Codes(20);

        var read = await Sut(client).GetForProducersAsync(codes, CancellationToken.None);

        Assert.True(read.Ok, read.Detail);
        // 1234 / 500 -> pages at skip 0, 500, 1000 for P000007, PLUS one page for P000006: the two share an
        // alias, and an overflowing alias's first page mixes both producers' rows, so the whole group is
        // re-read the paged way rather than guessing which rows belonged to whom.
        Assert.Equal(4, client.SingularPagedCalls);
        var ids = read.Value!.Select(c => c.ContractId).ToHashSet();
        Assert.Equal(1234, ids.Count(id => id.StartsWith("P000007-")));
        // Its pair partner in the same alias must still be present exactly once.
        Assert.Equal(AliasClient.ContractsFor("P000006"), read.Value!.Count(c => c.CustomerId == "P000006"));
        Assert.Equal(read.Value!.Count, ids.Count);                  // and nothing doubled
    }

    // -------------------------------------------------------------------------------------------------
    // Configuration guard rails.

    [Fact]
    public async Task CodesPerAliasIsClampedToTwo_TheMeasuredSafeListSize()
    {
        var client = new AliasClient();
        var codes = Codes(100);

        var read = await Sut(client, Config(aliasCount: 10, codesPerAlias: 5)).GetForProducersAsync(codes, CancellationToken.None);

        Assert.True(read.Ok, read.Detail);
        Assert.Equal(5, client.AliasedCalls);                        // 100 / (10 x 2), not 100 / (10 x 5)
        Assert.All(client.Documents, d => Assert.DoesNotMatch(@"customerIds: \[[^\]]*,[^\]]*,", d)); // never 3 codes in one list
    }

    [Fact]
    public void AliasedDocument_HasOneAliasPerGroup_AndNoCommentLines()
    {
        var groups = new List<IReadOnlyList<string>> { new[] { "AAA", "BBB" }, new[] { "CCC" } };

        var document = CtrmQueries.ContractsByCustomersAliased(groups, 500, "P");

        Assert.Contains("a0: contracts(skip: 0, take: 500, customerIds: [\"AAA\",\"BBB\"], contractPrefixType: \"P\")", document);
        Assert.Contains("a1: contracts(skip: 0, take: 500, customerId: \"CCC\", contractPrefixType: \"P\")", document);
        Assert.DoesNotContain('#', document);
        Assert.Contains("openBalanceQuantity", document);           // the core projection rode along
        Assert.DoesNotContain("pricingLines", document);            // and the pricing lines did not
    }
}
