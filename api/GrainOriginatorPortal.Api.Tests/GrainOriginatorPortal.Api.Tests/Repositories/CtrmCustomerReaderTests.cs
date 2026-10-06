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

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            lock (Documents) Documents.Add(document);
            Assert.DoesNotContain('#', document);

            var matches = Alias.Matches(document);
            Assert.NotEmpty(matches);
            var pages = new Dictionary<string, CtrmPage<CtrmCustomerDto>>();
            foreach (System.Text.RegularExpressions.Match m in matches)
            {
                var code = JsonSerializer.Deserialize<string>(m.Groups[2].Value)!;
                pages[$"c{m.Groups[1].Value}"] = new CtrmPage<CtrmCustomerDto>
                {
                    TotalCount = 1,
                    Items = [Row(code, id: 100 + int.Parse(m.Groups[1].Value))]
                };
            }

            if (DropAlias is not null) pages.Remove(DropAlias);

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

    private static IConfiguration Config(int aliasCount = 20, int concurrency = 2) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [CtrmCustomerReader.AliasCountKey] = aliasCount.ToString(),
            [CtrmCustomerReader.ConcurrencyKey] = concurrency.ToString(),
            ["Ctrm:BackgroundMaxDeferSeconds"] = "0",
            ["Ctrm:ServerTimeoutRetries"] = "0",
            ["Ctrm:ServerTimeoutRetryDelaySeconds"] = "0"
        }).Build();

    private static CtrmCustomerReader Sut(ICtrmGraphQlClient client, IConfiguration? config = null) =>
        new(client, config ?? Config(), new Mock<ILogger<CtrmCustomerReader>>().Object);

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
}
