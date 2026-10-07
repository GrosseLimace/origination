// System namespaces
using System.Text.Json;
using System.Text.RegularExpressions;

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
/// The customer master lookup the nightly sync uses: aliased <c>customers(sourceCode:)</c> fields, a
/// configurable number per request. The property that matters most is that it never hands back a
/// shorter dictionary than it was asked for - a missing code makes the sync deactivate that customer.
/// </summary>
[Collection("CtrmThrottle")]
public class CtrmCustomerReaderTests
{
    public CtrmCustomerReaderTests()
    {
        CtrmTradeUnitThrottle.ResetForTests();
    }

    /// <summary>
    /// Answers the aliased customers document by parsing the alias filters out of it: one row per alias
    /// whose <c>SourceCode</c> is the code sent. Records every document it receives.
    /// </summary>
    private sealed class CustomerAliasClient : ICtrmGraphQlClient
    {
        private static readonly Regex Alias = new(@"c(\d+): customers\(skip: 0, take: 5, sourceCode: (""[^""]*"")", RegexOptions.Compiled);

        public bool IsConfigured { get; init; } = true;
        public List<string> Documents { get; } = [];
        public int Calls { get { lock (Documents) return Documents.Count; } }

        /// <summary>Chunk index (the first code's number divided by <see cref="ChunkSize"/>) answered with <see cref="FailWith"/>.</summary>
        public int? FailChunk { get; init; }
        public int ChunkSize { get; init; } = 20;
        /// <summary>The failure for <see cref="FailChunk"/>. A PartialSuccess answer also carries the data, as data-plus-errors does.</summary>
        public CtrmReadResult<Dictionary<string, CtrmPage<CtrmCustomerDto>>>? FailWith { get; init; }
        /// <summary>Alias dropped from every response, to model a malformed answer.</summary>
        public string? DropAlias { get; init; }
        /// <summary>Chunk index (as for <see cref="FailChunk"/>) whose request throws a TaskCanceledException the caller did not ask for (an HTTP timeout).</summary>
        public int? ThrowChunk { get; init; }
        /// <summary>Codes answered with these rows instead of the default single row (duplicates).</summary>
        public Dictionary<string, List<CtrmCustomerDto>> RowsFor { get; } = new(StringComparer.OrdinalIgnoreCase);
        /// <summary>The answer to <see cref="CtrmCustomerQueries.CustomersProbe"/>.</summary>
        public CtrmReadResult<JsonElement> ProbeAnswer { get; init; } = new()
        {
            Status = CtrmReadStatus.Ok, HttpStatus = 200,
            Value = JsonSerializer.SerializeToElement(new { customers = new { totalCount = 16700, items = new[] { new { sourceCode = "P000042", activeYN = "Y" } } } })
        };

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            lock (Documents) Documents.Add(document);
            Assert.DoesNotContain('#', document);

            if (document == CtrmCustomerQueries.CustomersProbe)
                return Task.FromResult((CtrmReadResult<T>)(object)ProbeAnswer);

            var matches = Alias.Matches(document);
            Assert.NotEmpty(matches);
            var pages = new Dictionary<string, CtrmPage<CtrmCustomerDto>>();
            foreach (System.Text.RegularExpressions.Match m in matches)
            {
                var code = JsonSerializer.Deserialize<string>(m.Groups[2].Value)!;
                var items = RowsFor.TryGetValue(code, out var rows) ? rows : [Row(code, id: 100 + int.Parse(m.Groups[1].Value))];
                pages[$"c{m.Groups[1].Value}"] = new CtrmPage<CtrmCustomerDto> { TotalCount = items.Count, Items = items };
            }

            if (DropAlias is not null) pages.Remove(DropAlias);

            if (ThrowChunk is { } throwChunk)
            {
                var first = JsonSerializer.Deserialize<string>(matches[0].Groups[2].Value)!;
                if (int.Parse(first[1..]) / ChunkSize == throwChunk)
                    return Task.FromException<CtrmReadResult<T>>(new TaskCanceledException("stub: the request timed out"));
            }

            if (FailChunk is { } failChunk && FailWith is { } failure)
            {
                var first = JsonSerializer.Deserialize<string>(matches[0].Groups[2].Value)!;
                if (int.Parse(first[1..]) / ChunkSize == failChunk)
                {
                    var answer = failure.Status == CtrmReadStatus.PartialSuccess ? failure with { Value = pages } : failure;
                    return Task.FromResult((CtrmReadResult<T>)(object)answer);
                }
            }

            return Task.FromResult(new CtrmReadResult<T> { Status = CtrmReadStatus.Ok, HttpStatus = 200, Value = (T)(object)pages });
        }

        public static CtrmCustomerDto Row(string code, int id, string activeYN = "Y", bool master = false) => new()
        {
            Id = JsonSerializer.SerializeToElement(id),
            SourceCode = code,
            Name = code + " Farms",
            ActiveYN = activeYN,
            IndustryCode1 = "PR",
            MdmMasterRecord = JsonSerializer.SerializeToElement(master)
        };
    }

    /// <summary>Configuration for the aliased fallback path; <paramref name="strategy"/> is pinned to
    /// <c>aliased</c> because sourceCodes is the default since E7.</summary>
    private static IConfiguration Config(int aliasCount = 20, int concurrency = 2, string strategy = "aliased") =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [CtrmCustomerReader.LookupStrategyKey] = strategy,
            [CtrmCustomerReader.AliasCountKey] = aliasCount.ToString(),
            [CtrmCustomerReader.ConcurrencyKey] = concurrency.ToString(),
            ["Ctrm:BackgroundMaxDeferSeconds"] = "0",
            ["Ctrm:ServerTimeoutRetries"] = "0",
            ["Ctrm:ServerTimeoutRetryDelaySeconds"] = "0"
        }).Build();

    private static CtrmCustomerReader Sut(ICtrmGraphQlClient client, IConfiguration? config = null) =>
        new(client, config ?? Config(), new Mock<ILogger<CtrmCustomerReader>>().Object);

    private static void VerifyWarning(Mock<ILogger<CtrmCustomerReader>> logger, Func<string, bool> message, Times times) =>
        logger.Verify(l => l.Log(
            LogLevel.Warning, It.IsAny<EventId>(),
            It.Is<It.IsAnyType>((v, _) => message(v.ToString()!)),
            It.IsAny<Exception?>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()), times);

    private static List<string> Codes(int count) => [.. Enumerable.Range(0, count).Select(i => $"P{i:D6}")];

    // -------------------------------------------------------------------------------------------------
    // Happy path

    [Fact]
    public async Task GetBySourceCodesAsync_FortyFiveCodesAtAliasCountTwenty_MakesThreeRequests_AndKeysEveryCodeCaseInsensitively()
    {
        var client = new CustomerAliasClient();
        // 40 numbered codes, every fifth with a trailing space, plus five mixed-case / padded ones = 45 distinct.
        var codes = Codes(40).Select((c, i) => i % 5 == 0 ? c + " " : c).ToList();
        codes.AddRange(["TATOBIN ", "smitfar", "Jones1", " abc12 ", "xyz9"]);

        var read = await Sut(client, Config(aliasCount: 20)).GetBySourceCodesAsync(codes, CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Ok, read.Status);
        var lookup = read.Value!;
        Assert.Equal(45, lookup.Requested);
        Assert.Equal(3, lookup.Requests);
        Assert.Equal(3, client.Calls);
        Assert.Equal(45, lookup.Found);
        Assert.Equal(0, lookup.Missing);
        Assert.True(lookup.ByCode.ContainsKey("tatobin"));
        Assert.Equal("TATOBIN", lookup.ByCode["TATOBIN"].SourceCode);
        Assert.Equal("smitfar", lookup.ByCode["SMITFAR"].SourceCode);
        Assert.True(lookup.ByCode.ContainsKey("P000000"));     // trailing space trimmed before it was sent
        Assert.True(lookup.ByCode.ContainsKey("ABC12"));

        // Alias c{i} maps onto chunk[i] for every code: the fake's id is 100 + the alias index the code was sent under.
        var sent = codes.Select(c => c.Trim()).OrderBy(c => c, StringComparer.OrdinalIgnoreCase).ToList();
        for (var position = 0; position < sent.Count; position++)
            Assert.Equal((100 + position % 20).ToString(), lookup.ByCode[sent[position]].IdText);
    }

    [Fact]
    public async Task GetBySourceCodesAsync_EmptyInput_MakesNoRequest()
    {
        var client = new CustomerAliasClient();

        var read = await Sut(client).GetBySourceCodesAsync([], CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Ok, read.Status);
        Assert.Equal(0, read.Value!.Requested);
        Assert.Equal(0, read.Value.Requests);
        Assert.Empty(read.Value.ByCode);
        Assert.Equal(0, client.Calls);
    }

    // -------------------------------------------------------------------------------------------------
    // Fail closed: any chunk failure fails the whole read - a short dictionary would deactivate customers.

    private static CtrmReadResult<Dictionary<string, CtrmPage<CtrmCustomerDto>>> Failure(
        CtrmReadStatus status, int httpStatus, string? errorCode = null, string detail = "stub failure") =>
        new() { Status = status, HttpStatus = httpStatus, ErrorCode = errorCode, Detail = detail };

    [Fact]
    public async Task GetBySourceCodesAsync_OneChunkUnauthorized_FailsTheWholeRead_WithPermissionMissing()
    {
        var client = new CustomerAliasClient { FailChunk = 1, FailWith = Failure(CtrmReadStatus.Unauthorized, 403) };

        var read = await Sut(client).GetBySourceCodesAsync(Codes(60), CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Unauthorized, read.Status);
        Assert.False(read.Ok);
        Assert.Null(read.Value);
        Assert.Equal(403, read.HttpStatus);
        Assert.Equal("missing", CtrmCustomerReader.DescribePermission(read));
        Assert.Contains("Customers.Read.All", read.Detail);
    }

    [Fact]
    public async Task GetBySourceCodesAsync_HotChocolateAuthError_IsReportedAsPermissionMissing()
    {
        var client = new CustomerAliasClient
        {
            FailChunk = 0,
            FailWith = Failure(CtrmReadStatus.QueryError, 200, "AUTH_NOT_AUTHORIZED", "The current user is not authorized to access this resource.")
        };

        var read = await Sut(client).GetBySourceCodesAsync(Codes(30), CancellationToken.None);

        Assert.False(read.Ok);
        Assert.Null(read.Value);
        Assert.Equal("AUTH_NOT_AUTHORIZED", read.ErrorCode);
        Assert.Equal("missing", CtrmCustomerReader.DescribePermission(read));
        Assert.Contains("Customers.Read.All", read.Detail);
    }

    [Fact]
    public async Task GetBySourceCodesAsync_Http400QueryError_IsReportedAsSchemaMismatch()
    {
        var client = new CustomerAliasClient
        {
            FailChunk = 0,
            FailWith = Failure(CtrmReadStatus.QueryError, 400, "HC0020", "The field `merchandisingPhone` does not exist on the type `Customer`.")
        };

        var read = await Sut(client).GetBySourceCodesAsync(Codes(30), CancellationToken.None);

        Assert.Equal(CtrmReadStatus.QueryError, read.Status);
        Assert.Null(read.Value);
        Assert.Contains("CtrmCustomerQueries.CustomerProjection", read.Detail);
        Assert.Contains("merchandisingPhone", read.Detail);      // the API's own message survives behind the prefix
        Assert.Equal("unknown", CtrmCustomerReader.DescribePermission(read));
    }

    [Fact]
    public async Task GetBySourceCodesAsync_PartialSuccess_IsAFailure()
    {
        // Data plus errors on one chunk: an errored alias is a customer we do not have, and a short
        // dictionary would make the sync deactivate it.
        var client = new CustomerAliasClient { FailChunk = 2, FailWith = Failure(CtrmReadStatus.PartialSuccess, 200, "HC0018", "stub partial") };

        var read = await Sut(client).GetBySourceCodesAsync(Codes(60), CancellationToken.None);

        Assert.False(read.Ok);                                   // never "Ok" with a null or short dictionary
        Assert.Null(read.Value);
        Assert.Equal(CtrmReadStatus.QueryError, read.Status);
        Assert.Equal("unknown", CtrmCustomerReader.DescribePermission(read));
        Assert.Contains("partial answer (data plus errors): ", read.Detail);
    }

    [Fact]
    public async Task GetBySourceCodesAsync_OkResponseMissingAnAlias_FailsTheWholeRead()
    {
        var client = new CustomerAliasClient { DropAlias = "c3" };

        var read = await Sut(client).GetBySourceCodesAsync(Codes(10), CancellationToken.None);

        Assert.False(read.Ok);
        Assert.Null(read.Value);
        Assert.Equal(CtrmReadStatus.Error, read.Status);
    }

    // -------------------------------------------------------------------------------------------------
    // Filter mismatch: a row that does not carry the requested sourceCode means the filter is no longer
    // an exact match, so nothing from the read is trusted.

    [Fact]
    public async Task GetBySourceCodesAsync_RowCarryingAnotherSourceCode_FailsTheWholeRead_AsFilterMismatch()
    {
        var client = new CustomerAliasClient();
        client.RowsFor["P000003"] = [CustomerAliasClient.Row("P000099", id: 1)];
        var logger = new Mock<ILogger<CtrmCustomerReader>>();

        var read = await new CtrmCustomerReader(client, Config(), logger.Object).GetBySourceCodesAsync(Codes(45), CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Error, read.Status);
        Assert.Equal(CtrmCustomerReader.FilterMismatchCode, read.ErrorCode);
        Assert.Null(read.Value);
        Assert.Contains("no longer an exact match", read.Detail);
        Assert.Equal("unknown", CtrmCustomerReader.DescribePermission(read));
        VerifyWarning(logger, m => m.Contains("CUSTOMER_SYNC_FILTER_MISMATCH"), Times.Once());
    }

    [Fact]
    public async Task GetBySourceCodesAsync_ExactRowPlusAStrayRow_FailsRatherThanCountingADuplicate()
    {
        var client = new CustomerAliasClient();
        client.RowsFor["P000003"] = [CustomerAliasClient.Row("P000003", id: 1), CustomerAliasClient.Row("P0000031", id: 2)];

        var read = await Sut(client).GetBySourceCodesAsync(Codes(45), CancellationToken.None);

        Assert.Equal(CtrmCustomerReader.FilterMismatchCode, read.ErrorCode);
        Assert.Null(read.Value);
    }

    [Fact]
    public async Task GetBySourceCodesAsync_RowWithBlankSourceCode_IsAFilterMismatch()
    {
        var client = new CustomerAliasClient();
        client.RowsFor["P000003"] = [CustomerAliasClient.Row("  ", id: 1)];

        var read = await Sut(client).GetBySourceCodesAsync(Codes(45), CancellationToken.None);

        Assert.Equal(CtrmCustomerReader.FilterMismatchCode, read.ErrorCode);
        Assert.Null(read.Value);
    }

    [Fact]
    public async Task GetBySourceCodesAsync_SourceCodeDifferingOnlyByCaseOrPadding_IsAccepted()
    {
        var client = new CustomerAliasClient();
        client.RowsFor["P000003"] = [CustomerAliasClient.Row(" p000003 ", id: 1)];

        var read = await Sut(client).GetBySourceCodesAsync(Codes(45), CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Ok, read.Status);
        Assert.True(read.Value!.ByCode.ContainsKey("P000003"));
        Assert.Equal(45, read.Value.Found);
    }

    // -------------------------------------------------------------------------------------------------
    // Timeouts and cancellations fail clearly.

    [Fact]
    public async Task GetBySourceCodesAsync_ServerTimeoutAfterRetries_IsSourceUnavailable_NotSchemaMismatch()
    {
        var client = new CustomerAliasClient
        {
            FailChunk = 0,
            FailWith = Failure(CtrmReadStatus.QueryError, 400, CtrmServerTimeoutRetry.ServerTimeoutCode, "The request exceeded the configured timeout of `00:00:30`.")
        };
        var logger = new Mock<ILogger<CtrmCustomerReader>>();

        var read = await new CtrmCustomerReader(client, Config(), logger.Object).GetBySourceCodesAsync(Codes(30), CancellationToken.None);

        Assert.Null(read.Value);
        Assert.DoesNotContain("CustomerProjection", read.Detail);
        Assert.Contains("HC0045", read.Detail);
        VerifyWarning(logger, m => m.Contains("CUSTOMER_SYNC_SOURCE_UNAVAILABLE"), Times.Once());
    }

    [Fact]
    public async Task GetBySourceCodesAsync_ChunkCancelledWithoutTheCaller_FailsTheWholeRead_AsError()
    {
        var client = new CustomerAliasClient { ThrowChunk = 1 };

        var read = await Sut(client).GetBySourceCodesAsync(Codes(60), CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Error, read.Status);
        Assert.False(read.Ok);
        Assert.Null(read.Value);
        Assert.Contains("cancel", read.Detail, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task GetBySourceCodesAsync_FailureWarning_CapsTheDetailAt500Characters()
    {
        var longDetail = new string('x', 2000);
        var client = new CustomerAliasClient { FailChunk = 0, FailWith = Failure(CtrmReadStatus.Throttled, 429, detail: longDetail) };
        var logger = new Mock<ILogger<CtrmCustomerReader>>();

        var read = await new CtrmCustomerReader(client, Config(), logger.Object).GetBySourceCodesAsync(Codes(30), CancellationToken.None);

        Assert.Contains(longDetail, read.Detail);                // the result keeps the full detail
        VerifyWarning(logger, m => m.Contains("CUSTOMER_SYNC_SOURCE_UNAVAILABLE") && m.Contains(new string('x', 400)) && !m.Contains(new string('x', 501)), Times.Once());
    }

    [Fact]
    public async Task GetBySourceCodesAsync_FirstChunkFails_RemainingChunksAreNotSent()
    {
        var client = new CustomerAliasClient { FailChunk = 0, FailWith = Failure(CtrmReadStatus.EgressBlocked, 0) };

        var read = await Sut(client, Config(aliasCount: 20, concurrency: 1)).GetBySourceCodesAsync(Codes(60), CancellationToken.None);

        Assert.Equal(CtrmReadStatus.EgressBlocked, read.Status);
        Assert.Null(read.Value);
        Assert.Equal("unknown", CtrmCustomerReader.DescribePermission(read));
        Assert.Equal(1, client.Calls);
    }

    [Fact]
    public void DescribePermission_Ok_IsGranted()
    {
        Assert.Equal("granted", CtrmCustomerReader.DescribePermission(new CtrmReadResult<CtrmCustomerLookup> { Status = CtrmReadStatus.Ok }));
        Assert.Equal("granted", CtrmCustomerReader.DescribePermission(new CtrmReadResult<CtrmCustomerLookup> { Status = CtrmReadStatus.PartialSuccess }));
        Assert.Equal("missing", CtrmCustomerReader.DescribePermission(new CtrmReadResult<CtrmCustomerLookup> { Status = CtrmReadStatus.PartialSuccess, ErrorCode = "AUTH_NOT_AUTHENTICATED" }));
        Assert.Equal("unknown", CtrmCustomerReader.DescribePermission(new CtrmReadResult<CtrmCustomerLookup> { Status = CtrmReadStatus.Throttled }));
    }

    // -------------------------------------------------------------------------------------------------
    // Duplicates: more than one master row per sourceCode keeps one canonical row.

    [Fact]
    public void PickCanonical_PrefersActive_ThenMasterRecord_ThenLowestId()
    {
        var candidates = new List<CtrmCustomerDto>
        {
            CustomerAliasClient.Row("DUPE1", id: 1, activeYN: "N", master: true),
            CustomerAliasClient.Row("DUPE1", id: 9, activeYN: "Y", master: false),
            CustomerAliasClient.Row("DUPE1", id: 5, activeYN: "Y", master: true),
            CustomerAliasClient.Row("DUPE1", id: 3, activeYN: "Y", master: true),
        };

        var canonical = CtrmCustomerReader.PickCanonical(candidates);

        Assert.Equal("3", canonical!.IdText);
        Assert.Null(CtrmCustomerReader.PickCanonical([]));
    }

    [Fact]
    public async Task GetBySourceCodesAsync_CodeWithThreeRows_CountsOneDuplicate_AndKeepsTheCanonical()
    {
        var client = new CustomerAliasClient();
        client.RowsFor["P000004"] =
        [
            CustomerAliasClient.Row("P000004", id: 1, activeYN: "N"),
            CustomerAliasClient.Row("P000004", id: 9, activeYN: "Y", master: false),
            CustomerAliasClient.Row("P000004", id: 7, activeYN: "Y", master: true),
        ];
        var logger = new Mock<ILogger<CtrmCustomerReader>>();
        var codes = Codes(25);

        var read = await new CtrmCustomerReader(client, Config(), logger.Object).GetBySourceCodesAsync(codes, CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Ok, read.Status);
        Assert.Equal(1, read.Value!.Duplicates);
        Assert.Equal(codes.Count, read.Value.Found);
        Assert.Equal(0, read.Value.Missing);
        Assert.Equal("7", read.Value.ByCode["P000004"].IdText);
        // Logged once, by code only - never a name.
        logger.Verify(l => l.Log(
            LogLevel.Warning, It.IsAny<EventId>(),
            It.Is<It.IsAnyType>((v, _) => v.ToString()!.Contains("CUSTOMER_SYNC_DUPLICATE_SOURCE_CODE")
                && v.ToString()!.Contains("P000004") && !v.ToString()!.Contains("Farms")),
            It.IsAny<Exception?>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Once);
    }

    // -------------------------------------------------------------------------------------------------
    // Probe: what Dev will see first is the missing permission, named as such.

    [Fact]
    public async Task ProbeAsync_Unauthorized_ReportsPermissionMissing_WithoutSecondRequest()
    {
        var client = new CustomerAliasClient
        {
            ProbeAnswer = new() { Status = CtrmReadStatus.Unauthorized, HttpStatus = 403, Detail = "stub 403" }
        };

        var read = await Sut(client).ProbeAsync("P000042", CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Unauthorized, read.Status);
        Assert.Equal("missing", read.Value!.Permission);
        Assert.False(read.Value.ProjectionAccepted);
        Assert.Contains("Customers.Read.All", read.Detail);
        Assert.Equal(1, client.Calls);
    }

    [Fact]
    public async Task ProbeAsync_OkWithSample_RunsTheFullProjection_AndReportsProjectionAccepted_AndIdKind()
    {
        var client = new CustomerAliasClient();

        var read = await Sut(client).ProbeAsync(" P000042 ", CancellationToken.None);

        Assert.True(read.Ok, read.Detail);
        var probe = read.Value!;
        Assert.Equal("granted", probe.Permission);
        Assert.Equal(16700, probe.TotalCount);
        Assert.True(probe.ProjectionAccepted);
        Assert.True(probe.SampleFound);
        Assert.Equal("Number", probe.IdKind);
        Assert.Equal(2, client.Calls);
        Assert.Equal(CtrmCustomerQueries.CustomersProbe, client.Documents[0]);
        Assert.Contains(CtrmCustomerQueries.CustomerProjection, client.Documents[1]);
    }

    [Fact]
    public async Task ProbeAsync_SampleLookupHttp400_ReportsProjectionNotAccepted_WithTheSchemaDetail()
    {
        var client = new CustomerAliasClient
        {
            FailChunk = 0,
            FailWith = Failure(CtrmReadStatus.QueryError, 400, "HC0020", "The field `merchandisingPhone` does not exist on the type `Customer`.")
        };

        var read = await Sut(client).ProbeAsync("P000001", CancellationToken.None);

        var probe = read.Value!;
        Assert.Equal("granted", probe.Permission);
        Assert.False(probe.ProjectionAccepted);
        Assert.False(probe.SampleFound);
        Assert.Null(probe.IdKind);
        Assert.Contains("CtrmCustomerQueries.CustomerProjection", read.Detail);
        Assert.Equal(2, client.Calls);
    }

    // =================================================================================================
    // E7: the sourceCodes list path (the default). One customers(sourceCodes:) request per chunk, chunks
    // sized by the estimated rendered filter length, paged with skip/take; the same fail-closed rules.

    /// <summary>
    /// Answers <see cref="CtrmCustomerQueries.CustomersBySourceCodes"/> from its variables: one row per
    /// requested code unless <see cref="RowsFor"/> or <see cref="Unknown"/> says otherwise, sliced by
    /// skip/take. Any other customers document fails the test, so the routing is proven by the fake.
    /// </summary>
    private sealed class CustomerListClient : ICtrmGraphQlClient
    {
        public sealed record Request(string Document, IReadOnlyList<string> Codes, int Skip, int Take, bool HasSourceSystem, string? SourceSystem);

        public bool IsConfigured => true;
        public List<string> Documents { get; } = [];
        public List<Request> Requests { get; } = [];
        public int Calls { get { lock (Documents) return Documents.Count; } }

        /// <summary>Codes answered with these rows instead of the default single row.</summary>
        public Dictionary<string, List<CtrmCustomerDto>> RowsFor { get; } = new(StringComparer.OrdinalIgnoreCase);
        /// <summary>Codes CTRM does not know (no rows).</summary>
        public HashSet<string> Unknown { get; } = new(StringComparer.OrdinalIgnoreCase);
        /// <summary>(codes, skip) → a failure to answer instead; null = answer normally. PartialSuccess also carries the data.</summary>
        public Func<IReadOnlyList<string>, int, CtrmReadResult<Dictionary<string, CtrmPage<CtrmCustomerDto>>>?>? FailWhen { get; init; }
        /// <summary>Requests (by their codes) that throw a TaskCanceledException the caller did not ask for.</summary>
        public Func<IReadOnlyList<string>, bool>? ThrowWhen { get; init; }
        /// <summary>Every page claims another page follows (a server that never stops paging).</summary>
        public bool AlwaysHasNextPage { get; init; }
        public CtrmReadResult<JsonElement> ProbeAnswer { get; init; } = new()
        {
            Status = CtrmReadStatus.Ok, HttpStatus = 200,
            Value = JsonSerializer.SerializeToElement(new { customers = new { totalCount = 16700, items = new[] { new { sourceCode = "P000042", activeYN = "Y" } } } })
        };

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            lock (Documents) Documents.Add(document);
            Assert.DoesNotContain('#', document);

            if (document == CtrmCustomerQueries.CustomersProbe)
                return Task.FromResult((CtrmReadResult<T>)(object)ProbeAnswer);

            Assert.Equal(CtrmCustomerQueries.CustomersBySourceCodes, document);
            var map = variables!.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(variables));
            var codes = ((IEnumerable<string>)map["codes"]!).ToList();
            var skip = Convert.ToInt32(map["skip"]);
            var take = Convert.ToInt32(map["take"]);
            var hasSystem = map.TryGetValue("sourceSystem", out var system);
            lock (Requests) Requests.Add(new Request(document, codes, skip, take, hasSystem, system as string));

            if (ThrowWhen?.Invoke(codes) == true)
                return Task.FromException<CtrmReadResult<T>>(new TaskCanceledException("stub: the request timed out"));

            var all = new List<CtrmCustomerDto>();
            for (var i = 0; i < codes.Count; i++)
            {
                if (Unknown.Contains(codes[i])) continue;
                all.AddRange(RowsFor.TryGetValue(codes[i], out var rows) ? rows : [CustomerAliasClient.Row(codes[i], id: 1000 + i)]);
            }

            var page = new CtrmPage<CtrmCustomerDto>
            {
                TotalCount = all.Count,
                PageInfo = new CtrmPageInfo { Skip = skip, Take = take, HasNextPage = AlwaysHasNextPage || skip + take < all.Count },
                Items = [.. all.Skip(skip).Take(take)]
            };
            var data = new Dictionary<string, CtrmPage<CtrmCustomerDto>> { ["customers"] = page };

            if (FailWhen?.Invoke(codes, skip) is { } failure)
            {
                var answer = failure.Status == CtrmReadStatus.PartialSuccess ? failure with { Value = data } : failure;
                return Task.FromResult((CtrmReadResult<T>)(object)answer);
            }

            return Task.FromResult(new CtrmReadResult<T> { Status = CtrmReadStatus.Ok, HttpStatus = 200, Value = (T)(object)data });
        }
    }

    /// <summary>Configuration for the list path: the strategy key is ABSENT unless given, so the default is exercised.</summary>
    private static IConfiguration ListConfig(
        int concurrency = 2, string? strategy = null, string? maxFilterChars = null, string? maxPerRequest = null, string? sourceSystem = null)
    {
        var settings = new Dictionary<string, string?>
        {
            [CtrmCustomerReader.ConcurrencyKey] = concurrency.ToString(),
            ["Ctrm:BackgroundMaxDeferSeconds"] = "0",
            ["Ctrm:ServerTimeoutRetries"] = "0",
            ["Ctrm:ServerTimeoutRetryDelaySeconds"] = "0"
        };
        if (strategy is not null) settings[CtrmCustomerReader.LookupStrategyKey] = strategy;
        if (maxFilterChars is not null) settings[CtrmCustomerReader.SourceCodesMaxFilterCharsKey] = maxFilterChars;
        if (maxPerRequest is not null) settings[CtrmCustomerReader.SourceCodesMaxPerRequestKey] = maxPerRequest;
        if (sourceSystem is not null) settings[CtrmCustomerReader.SourceSystemKey] = sourceSystem;
        return new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
    }

    // -------------------------------------------------------------------------------------------------
    // Chunking by estimated filter length

    [Fact]
    public void ChunkBySourceCodeFilterLength_FiveHundredSevenCharCodesAtBudget6000_ChunksOfAtMost375_InOrder()
    {
        // The measured rejection: 500 seven-char codes rendered to 7,987 encoded characters (limit 7,000).
        // Estimated 7 + 9 = 16 per code, so a 6,000 budget holds 375.
        var codes = Codes(500);

        var chunks = CtrmCustomerReader.ChunkBySourceCodeFilterLength(codes, 6000, 400);

        Assert.Equal([375, 125], chunks.Select(c => c.Count));
        Assert.All(chunks, c => Assert.True(c.Count <= 375));
        Assert.Equal(codes, chunks.SelectMany(c => c));
    }

    [Fact]
    public void ChunkBySourceCodeFilterLength_MaxPerRequestCapsAChunkBeforeTheBudgetDoes()
    {
        var codes = Codes(500);

        var chunks = CtrmCustomerReader.ChunkBySourceCodeFilterLength(codes, 7000, 100);

        Assert.Equal([100, 100, 100, 100, 100], chunks.Select(c => c.Count));
        Assert.Equal(codes, chunks.SelectMany(c => c));
    }

    [Fact]
    public void ChunkBySourceCodeFilterLength_CodeLongerThanTheBudget_FormsItsOwnChunk()
    {
        var longCode = new string('X', 600);

        var chunks = CtrmCustomerReader.ChunkBySourceCodeFilterLength(["A1", "B2", longCode, "C3"], 500, 400);

        Assert.Equal(3, chunks.Count);
        Assert.Equal(["A1", "B2"], chunks[0]);
        Assert.Equal([longCode], chunks[1]);
        Assert.Equal(["C3"], chunks[2]);
    }

    [Fact]
    public void ChunkBySourceCodeFilterLength_NoCodes_NoChunks()
    {
        Assert.Empty(CtrmCustomerReader.ChunkBySourceCodeFilterLength([], 6000, 400));
    }

    // -------------------------------------------------------------------------------------------------
    // Strategy routing

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("sourceCodes")]
    [InlineData("something-else")]
    public async Task GetBySourceCodesAsync_StrategyNotAliased_SendsTheSourceCodesListDocument(string? strategy)
    {
        var client = new CustomerListClient();

        var read = await Sut(client, ListConfig(strategy: strategy)).GetBySourceCodesAsync(Codes(10), CancellationToken.None);

        Assert.True(read.Ok, read.Detail);
        Assert.Equal(10, read.Value!.Found);
        Assert.Equal([CtrmCustomerQueries.CustomersBySourceCodes], client.Documents);
    }

    [Theory]
    [InlineData("aliased")]
    [InlineData(" ALIASED ")]
    public async Task GetBySourceCodesAsync_StrategyAliased_SendsTheAliasedDocument(string strategy)
    {
        var client = new CustomerAliasClient();

        var read = await Sut(client, Config(strategy: strategy)).GetBySourceCodesAsync(Codes(10), CancellationToken.None);

        Assert.True(read.Ok, read.Detail);
        Assert.Equal(10, read.Value!.Found);
        Assert.Single(client.Documents);
        Assert.StartsWith("query {\n  c0: customers(skip: 0, take: 5, sourceCode: ", client.Documents[0]);
    }

    // -------------------------------------------------------------------------------------------------
    // List path happy path

    [Fact]
    public async Task GetBySourceCodesAsync_ListPath_450CodesAtDefaults_TwoRequests_KeyedByRequestedCode_CaseAndPaddingTolerated()
    {
        var client = new CustomerListClient();
        var codes = Codes(447);
        codes.AddRange(["tatobin ", " Smitfar", "Jones1"]);
        client.Unknown.UnionWith(["P000010", "P000011"]);
        client.RowsFor["TATOBIN"] = [CustomerAliasClient.Row(" TATOBIN ", id: 7)];   // Db2 CHAR padding, other case

        var read = await Sut(client, ListConfig()).GetBySourceCodesAsync(codes, CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Ok, read.Status);
        var lookup = read.Value!;
        Assert.Equal(450, lookup.Requested);
        Assert.Equal(2, lookup.Requests);
        Assert.Equal(2, client.Calls);
        Assert.Equal(448, lookup.Found);
        Assert.Equal(2, lookup.Missing);
        Assert.Equal(0, lookup.Duplicates);
        Assert.False(lookup.ByCode.ContainsKey("P000010"));
        Assert.Equal("7", lookup.ByCode["TATOBIN"].IdText);
        Assert.True(lookup.ByCode.ContainsKey("smitfar"));
        Assert.True(lookup.ByCode.ContainsKey("JONES1"));

        // 375 + 75 codes at the 6,000-character default, every code sent exactly once, trimmed, first page only.
        Assert.Equal([375, 75], client.Requests.Select(r => r.Codes.Count).OrderByDescending(n => n));
        Assert.Equal(450, client.Requests.SelectMany(r => r.Codes).Distinct(StringComparer.Ordinal).Count());
        Assert.Contains("tatobin", client.Requests.SelectMany(r => r.Codes));
        Assert.All(client.Requests, r =>
        {
            Assert.Equal(0, r.Skip);
            Assert.Equal(CtrmCustomerReader.SourceCodesPageSize, r.Take);
            Assert.False(r.HasSourceSystem);                     // not configured → the variable is not sent at all
        });
    }

    [Fact]
    public async Task GetBySourceCodesAsync_ListPath_ConfiguredSourceSystem_IsSentAsAVariable()
    {
        var client = new CustomerListClient();

        var read = await Sut(client, ListConfig(sourceSystem: " CTRM ")).GetBySourceCodesAsync(Codes(5), CancellationToken.None);

        Assert.True(read.Ok, read.Detail);
        var request = Assert.Single(client.Requests);
        Assert.True(request.HasSourceSystem);
        Assert.Equal("CTRM", request.SourceSystem);
    }

    [Theory]
    [InlineData("100000", "1000", 437)]    // budget clamps to 7,000 → 7000 / 16 = 437 codes
    [InlineData("10", null, 31)]           // budget clamps to 500 → 500 / 16 = 31 codes
    [InlineData(null, "0", 1)]             // per-request cap clamps to 1
    [InlineData(null, "5000", 375)]        // per-request cap clamps to 1,000; the 6,000 default budget still binds
    [InlineData("garbage", "garbage", 375)] // unparseable → defaults (6,000 / 400)
    public async Task GetBySourceCodesAsync_ListPath_KnobsAreClamped(string? maxFilterChars, string? maxPerRequest, int expectedFirstChunk)
    {
        var client = new CustomerListClient();

        var read = await Sut(client, ListConfig(concurrency: 1, maxFilterChars: maxFilterChars, maxPerRequest: maxPerRequest))
            .GetBySourceCodesAsync(Codes(500), CancellationToken.None);

        Assert.True(read.Ok, read.Detail);
        Assert.Equal(expectedFirstChunk, client.Requests[0].Codes.Count);
        Assert.Equal(500, read.Value!.Found);
    }

    [Fact]
    public async Task GetBySourceCodesAsync_ListPath_PagesWithinAChunk_UntilNoNextPage_AndMergesTheRows()
    {
        // Three codes with 200 MDM rows each = 600 rows: page one (500) says hasNextPage, page two (100) does not.
        // The third code's only active row is the very last row, so it can only be picked if page two was merged.
        var client = new CustomerListClient();
        string[] codes = ["P000001", "P000002", "P000003"];
        for (var c = 0; c < codes.Length; c++)
            client.RowsFor[codes[c]] = [.. Enumerable.Range(0, 200).Select(i => CustomerAliasClient.Row(codes[c], id: c * 1000 + i, activeYN: i == 199 ? "Y" : "N"))];

        var read = await Sut(client, ListConfig()).GetBySourceCodesAsync(codes, CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Ok, read.Status);
        Assert.Equal(2, read.Value!.Requests);
        Assert.Equal([0, 500], client.Requests.Select(r => r.Skip));
        Assert.All(client.Requests, r => Assert.Equal(codes, r.Codes));
        Assert.Equal(3, read.Value.Found);
        Assert.Equal(3, read.Value.Duplicates);
        Assert.Equal("2199", read.Value.ByCode["P000003"].IdText);
    }

    [Fact]
    public async Task GetBySourceCodesAsync_ListPath_ServerThatNeverStopsPaging_FailsClosedAtThePageCap()
    {
        var client = new CustomerListClient { AlwaysHasNextPage = true };

        var read = await Sut(client, ListConfig()).GetBySourceCodesAsync(Codes(5), CancellationToken.None);

        Assert.False(read.Ok);
        Assert.Null(read.Value);
        Assert.Equal(CtrmCustomerReader.SourceCodesMaxPagesPerChunk, client.Calls);
        Assert.Contains($"{CtrmCustomerReader.SourceCodesMaxPagesPerChunk} page", read.Detail);
    }

    [Fact]
    public async Task GetBySourceCodesAsync_ListPath_CodeWithThreeRows_CountsOneDuplicate_AndKeepsTheCanonical()
    {
        var client = new CustomerListClient();
        client.RowsFor["P000004"] =
        [
            CustomerAliasClient.Row("P000004", id: 1, activeYN: "N"),
            CustomerAliasClient.Row("p000004", id: 9, activeYN: "Y", master: false),
            CustomerAliasClient.Row("P000004 ", id: 7, activeYN: "Y", master: true),
        ];
        var logger = new Mock<ILogger<CtrmCustomerReader>>();

        var read = await new CtrmCustomerReader(client, ListConfig(), logger.Object).GetBySourceCodesAsync(Codes(25), CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Ok, read.Status);
        Assert.Equal(1, read.Value!.Duplicates);
        Assert.Equal(25, read.Value.Found);
        Assert.Equal(0, read.Value.Missing);
        Assert.Equal("7", read.Value.ByCode["P000004"].IdText);
        VerifyWarning(logger, m => m.Contains("CUSTOMER_SYNC_DUPLICATE_SOURCE_CODE") && m.Contains("P000004") && !m.Contains("Farms"), Times.Once());
    }

    // -------------------------------------------------------------------------------------------------
    // List path fails closed

    [Fact]
    public async Task GetBySourceCodesAsync_ListPath_FirstChunkFails_AtConcurrencyOne_OtherChunksAreNotSent()
    {
        var client = new CustomerListClient { FailWhen = (codes, _) => codes[0] == "P000000" ? Failure(CtrmReadStatus.EgressBlocked, 0) : null };

        var read = await Sut(client, ListConfig(concurrency: 1, maxPerRequest: "100")).GetBySourceCodesAsync(Codes(300), CancellationToken.None);

        Assert.Equal(CtrmReadStatus.EgressBlocked, read.Status);
        Assert.Null(read.Value);
        Assert.Equal(1, client.Calls);
    }

    [Fact]
    public async Task GetBySourceCodesAsync_ListPath_LaterChunkUnauthorized_FailsTheWholeRead_WithPermissionMissing()
    {
        var client = new CustomerListClient { FailWhen = (codes, _) => codes[0] == "P000100" ? Failure(CtrmReadStatus.Unauthorized, 403) : null };

        var read = await Sut(client, ListConfig(maxPerRequest: "100")).GetBySourceCodesAsync(Codes(300), CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Unauthorized, read.Status);
        Assert.Null(read.Value);
        Assert.Equal("missing", CtrmCustomerReader.DescribePermission(read));
        Assert.Contains("Customers.Read.All", read.Detail);
    }

    [Fact]
    public async Task GetBySourceCodesAsync_ListPath_FailureOnASecondPage_FailsTheWholeRead()
    {
        var client = new CustomerListClient { FailWhen = (_, skip) => skip > 0 ? Failure(CtrmReadStatus.Throttled, 429) : null };
        client.RowsFor["P000001"] = [.. Enumerable.Range(0, 600).Select(i => CustomerAliasClient.Row("P000001", id: i))];

        var read = await Sut(client, ListConfig()).GetBySourceCodesAsync(Codes(3), CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Throttled, read.Status);
        Assert.Null(read.Value);
        Assert.Equal(2, client.Calls);
    }

    [Fact]
    public async Task GetBySourceCodesAsync_ListPath_PartialSuccess_IsAFailure()
    {
        var client = new CustomerListClient { FailWhen = (_, _) => Failure(CtrmReadStatus.PartialSuccess, 200, "HC0018", "stub partial") };

        var read = await Sut(client, ListConfig()).GetBySourceCodesAsync(Codes(30), CancellationToken.None);

        Assert.False(read.Ok);
        Assert.Null(read.Value);
        Assert.Equal(CtrmReadStatus.QueryError, read.Status);
        Assert.Contains("partial answer (data plus errors): ", read.Detail);
    }

    [Fact]
    public async Task GetBySourceCodesAsync_ListPath_ChunkCancelledWithoutTheCaller_FailsTheWholeRead_AsError()
    {
        var client = new CustomerListClient { ThrowWhen = codes => codes[0] == "P000100" };

        var read = await Sut(client, ListConfig(maxPerRequest: "100")).GetBySourceCodesAsync(Codes(300), CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Error, read.Status);
        Assert.Null(read.Value);
        Assert.Contains("cancel", read.Detail, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("P000099")]     // a code nobody asked for
    [InlineData("P000150")]     // a code requested - but in ANOTHER chunk
    [InlineData("   ")]         // blank
    public async Task GetBySourceCodesAsync_ListPath_RowWhoseSourceCodeThisChunkDidNotRequest_IsAFilterMismatch(string strayCode)
    {
        var client = new CustomerListClient();
        client.RowsFor["P000003"] = [CustomerAliasClient.Row("P000003", id: 1), CustomerAliasClient.Row(strayCode, id: 2)];
        var logger = new Mock<ILogger<CtrmCustomerReader>>();
        var codes = Codes(98).Concat(["P000150"]).ToList();      // chunks of 50: P000150 is in the second

        var read = await new CtrmCustomerReader(client, ListConfig(maxPerRequest: "50"), logger.Object).GetBySourceCodesAsync(codes, CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Error, read.Status);
        Assert.Equal(CtrmCustomerReader.FilterMismatchCode, read.ErrorCode);
        Assert.Null(read.Value);
        Assert.Contains("no longer an exact match", read.Detail);
        Assert.Equal("unknown", CtrmCustomerReader.DescribePermission(read));
        VerifyWarning(logger, m => m.Contains("CUSTOMER_SYNC_FILTER_MISMATCH"), Times.Once());
    }

    [Fact]
    public async Task GetBySourceCodesAsync_ListPath_FilterTooLongValidation_IsSourceUnavailable_NamingTheKnob()
    {
        var client = new CustomerListClient
        {
            FailWhen = (_, _) => Failure(CtrmReadStatus.QueryError, 200, "VALIDATION",
                "CTRM rejected the query: The filter is too long for the Profisee endpoint (7987 encoded characters, limit 7000). The limit is on the length of the rendered filter, not on the number of values (code VALIDATION)")
        };
        var logger = new Mock<ILogger<CtrmCustomerReader>>();

        var read = await new CtrmCustomerReader(client, ListConfig(), logger.Object).GetBySourceCodesAsync(Codes(30), CancellationToken.None);

        Assert.False(read.Ok);
        Assert.Null(read.Value);
        Assert.Equal("VALIDATION", read.ErrorCode);
        Assert.StartsWith("sourceCodes filter too long for the API — lower CustomerSync:SourceCodesMaxFilterChars: ", read.Detail);
        Assert.Contains("7987 encoded characters", read.Detail);
        VerifyWarning(logger, m => m.Contains("CUSTOMER_SYNC_SOURCE_UNAVAILABLE"), Times.Once());
    }

    [Fact]
    public async Task GetBySourceCodesAsync_ListPath_OtherValidationError_IsNotReportedAsFilterTooLong()
    {
        var client = new CustomerListClient
        {
            FailWhen = (_, _) => Failure(CtrmReadStatus.QueryError, 200, "VALIDATION", "CTRM rejected the query: take must be between 1 and 500 (code VALIDATION)")
        };

        var read = await Sut(client, ListConfig()).GetBySourceCodesAsync(Codes(3), CancellationToken.None);

        Assert.Null(read.Value);
        Assert.DoesNotContain("SourceCodesMaxFilterChars", read.Detail);
    }

    [Fact]
    public async Task GetBySourceCodesAsync_ListPath_ServerTimeout_IsSourceUnavailable_NotSchemaMismatch()
    {
        var client = new CustomerListClient
        {
            FailWhen = (_, _) => Failure(CtrmReadStatus.QueryError, 400, CtrmServerTimeoutRetry.ServerTimeoutCode, "The request exceeded the configured timeout of `00:00:30`.")
        };
        var logger = new Mock<ILogger<CtrmCustomerReader>>();

        var read = await new CtrmCustomerReader(client, ListConfig(), logger.Object).GetBySourceCodesAsync(Codes(30), CancellationToken.None);

        Assert.Null(read.Value);
        Assert.DoesNotContain("CustomerProjection", read.Detail);
        Assert.Contains("HC0045", read.Detail);
        VerifyWarning(logger, m => m.Contains("CUSTOMER_SYNC_SOURCE_UNAVAILABLE"), Times.Once());
    }

    [Fact]
    public async Task GetBySourceCodesAsync_ListPath_Http400QueryError_IsSchemaMismatch_NamingTheListDocument()
    {
        var client = new CustomerListClient
        {
            FailWhen = (_, _) => Failure(CtrmReadStatus.QueryError, 400, "HC0020", "The argument `sourceCodes` does not exist.")
        };
        var logger = new Mock<ILogger<CtrmCustomerReader>>();

        var read = await new CtrmCustomerReader(client, ListConfig(), logger.Object).GetBySourceCodesAsync(Codes(3), CancellationToken.None);

        Assert.Null(read.Value);
        Assert.Contains("CtrmCustomerQueries.CustomerProjection", read.Detail);
        Assert.Contains("CustomersBySourceCodes", read.Detail);
        Assert.Contains("sourceCodes", read.Detail);
        VerifyWarning(logger, m => m.Contains("CUSTOMER_SYNC_SCHEMA_MISMATCH"), Times.Once());
    }

    [Fact]
    public async Task ProbeAsync_DefaultStrategy_LooksTheSampleUpThroughTheListDocument()
    {
        var client = new CustomerListClient();

        var read = await Sut(client, ListConfig()).ProbeAsync(" P000042 ", CancellationToken.None);

        Assert.True(read.Ok, read.Detail);
        Assert.True(read.Value!.ProjectionAccepted);
        Assert.True(read.Value.SampleFound);
        Assert.Equal("Number", read.Value.IdKind);
        Assert.Equal([CtrmCustomerQueries.CustomersProbe, CtrmCustomerQueries.CustomersBySourceCodes], client.Documents);
        Assert.Equal(["P000042"], client.Requests.Single().Codes);
    }
}
