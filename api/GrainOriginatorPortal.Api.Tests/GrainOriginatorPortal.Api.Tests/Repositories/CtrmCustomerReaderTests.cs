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
}
