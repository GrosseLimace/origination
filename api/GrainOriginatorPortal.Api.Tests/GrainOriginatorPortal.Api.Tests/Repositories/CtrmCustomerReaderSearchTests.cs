// System namespaces
using System.Text.Json;

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
/// The add-customer search against the CTRM master (plan E3): one request with a <c>byName</c> alias and,
/// for a short single token, a <c>byCode</c> alias; the scope filters, the duplicate flag and the every-word
/// rule applied in memory; one row per code; capped at 50; and never a partial answer passed off as Ok.
/// </summary>
[Collection("CtrmThrottle")]
public class CtrmCustomerReaderSearchTests
{
    public CtrmCustomerReaderSearchTests()
    {
        CtrmTradeUnitThrottle.ResetForTests();
    }

    private sealed class SearchClient : ICtrmGraphQlClient
    {
        public bool IsConfigured => true;
        public List<(string Document, Dictionary<string, object?> Variables)> Calls { get; } = [];
        public List<CtrmCustomerDto> ByName { get; } = [];
        public List<CtrmCustomerDto> ByCode { get; } = [];
        public int? ByNameTotal { get; set; }
        public CtrmReadResult<Dictionary<string, CtrmPage<CtrmCustomerDto>>>? Answer { get; set; }

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            Assert.DoesNotContain('#', document);
            var vars = variables as Dictionary<string, object?> ?? [];
            Calls.Add((document, vars));
            if (Answer is not null) return Task.FromResult((CtrmReadResult<T>)(object)Answer);

            var pages = new Dictionary<string, CtrmPage<CtrmCustomerDto>>
            {
                ["byName"] = new() { TotalCount = ByNameTotal ?? ByName.Count, Items = ByName.ToList() }
            };
            if (document.Contains("byCode:")) pages["byCode"] = new() { TotalCount = ByCode.Count, Items = ByCode.ToList() };
            return Task.FromResult(new CtrmReadResult<T> { Status = CtrmReadStatus.Ok, HttpStatus = 200, Value = (T)(object)pages });
        }
    }

    private static CtrmCustomerDto Row(string code, string name, string active = "Y", string industry = "PR", string? duplicate = null, string id = "1") => new()
    {
        Id = JsonSerializer.SerializeToElement(id), SourceCode = code, Name = name, ActiveYN = active, IndustryCode1 = industry, DuplicateYN = duplicate,
        MdmMasterRecord = JsonSerializer.SerializeToElement("Y")
    };

    private static IConfiguration Config(bool extended = false, string? sourceSystem = null) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [CtrmCustomerReader.ExtendedFieldsKey] = extended ? "true" : "false",
            [CtrmCustomerReader.SourceSystemKey] = sourceSystem,
            ["Ctrm:InteractiveServerTimeoutRetries"] = "0",
            ["Ctrm:ServerTimeoutRetries"] = "0"
        }).Build();

    private static CtrmCustomerReader Sut(SearchClient client, IConfiguration? config = null) =>
        new(client, config ?? Config(), new Mock<ILogger<CtrmCustomerReader>>().Object);

    // -------------------------------------------------------------------------

    [Fact]
    public async Task MultiWordTerm_SendsTheLongestWordByName_AndNoCodeAlias()
    {
        var client = new SearchClient();
        client.ByName.AddRange([Row("SMITFAR", "SMITH FARMS LLC"), Row("JONESFA", "JONES FARMS"), Row("SMITHJO", "SMITH JONES")]);

        var read = await Sut(client).SearchAsync("smith farms", CancellationToken.None);

        Assert.True(read.Ok, read.Detail);
        var (document, vars) = Assert.Single(client.Calls);
        Assert.Contains("byName: customers(", document);
        Assert.DoesNotContain("byCode:", document);
        Assert.DoesNotContain("$code", document);
        Assert.Equal("smith", vars["name"]);                         // longest word wins ties by order: "smith" and "farms" are both 5 - first one
        Assert.False(vars.ContainsKey("sourceSystem"));
        Assert.Contains("industryCode1: \"PR\"", document);
        Assert.Contains(CtrmCustomerQueries.SearchExtraProjection, document);
        // Every word must appear in the name (or the code): "SMITH JONES" lacks "farms".
        Assert.Equal(["SMITFAR"], read.Value!.Items.Select(i => i.SourceCode));
    }

    [Fact]
    public async Task ShortSingleToken_AlsoSearchesByCode_AndMergesBothAliases()
    {
        var client = new SearchClient();
        client.ByName.Add(Row("POTATOF", "POTATO FARMS"));
        client.ByCode.AddRange([Row("TATOBIN", "T-A TOBIN FARMS LC"), Row("TATOB01", "T-A TOBIN - PARKER EAST")]);

        var read = await Sut(client, Config(sourceSystem: "CTRM")).SearchAsync("TATO", CancellationToken.None);

        Assert.True(read.Ok, read.Detail);
        var (document, vars) = Assert.Single(client.Calls);
        Assert.Contains("byCode: customers(", document);
        Assert.Contains("sourceCodeContains: $code", document);
        Assert.Equal("TATO", vars["code"]);
        Assert.Equal("CTRM", vars["sourceSystem"]);
        // Ordered by name: "POTATO FARMS", then "T-A TOBIN - PARKER EAST" ('-' sorts before 'F'), then "T-A TOBIN FARMS LC".
        Assert.Equal(["POTATOF", "TATOB01", "TATOBIN"], read.Value!.Items.Select(i => i.SourceCode));
    }

    [Theory]
    [InlineData("AB")]           // too short for a code
    [InlineData("TOOLONGCODE")]  // too long
    public void TokensOutsideThreeToSevenCharacters_DoNotGetACodeAlias(string term)
    {
        var client = new SearchClient();
        client.ByName.Add(Row("X", "AB TOOLONGCODE"));

        _ = Sut(client).SearchAsync(term, CancellationToken.None).Result;

        Assert.DoesNotContain("byCode:", Assert.Single(client.Calls).Document);
    }

    [Fact]
    public async Task OutOfScopeAndDuplicateRows_AreDropped_AndOneRowPerCodeIsKept()
    {
        var client = new SearchClient();
        client.ByName.AddRange(
        [
            Row("INACTIV", "INACTIVE FARM", active: "N"),
            Row("NOTPROD", "NOT A PRODUCER FARM", industry: "OT"),
            Row("DUPFARM", "DUPLICATE FARM", duplicate: "Y"),
            Row("DNUFARM", "DO NOT USE FARM"),
            Row("TWICE01", "TWICE FARM", id: "9"),
            Row("TWICE01", "TWICE FARM", id: "2"),
            Row("GOODFAR", "GOOD FARM")
        ]);

        var read = await Sut(client).SearchAsync("farm", CancellationToken.None);

        Assert.True(read.Ok, read.Detail);
        Assert.Equal(["GOODFAR", "TWICE01"], read.Value!.Items.Select(i => i.SourceCode));
        Assert.Equal("2", read.Value.Items.Single(i => i.SourceCode == "TWICE01").IdText);   // PickCanonical: lowest id text
        Assert.Equal(7, read.Value.Received);
    }

    [Fact]
    public async Task MoreThanFiftyMatches_AreCappedAtFifty_AndAFullPageFlagsTruncation()
    {
        var client = new SearchClient { ByNameTotal = 600 };
        client.ByName.AddRange(Enumerable.Range(0, 120).Select(i => Row($"F{i:D6}", $"FARM {i:D3}")));

        var read = await Sut(client).SearchAsync("farm", CancellationToken.None);

        Assert.True(read.Ok, read.Detail);
        Assert.Equal(CtrmCustomerReader.SearchMaxResults, read.Value!.Items.Count);
        Assert.True(read.Value.Truncated);
    }

    [Fact]
    public async Task ExtendedFieldsSetting_SelectsTheExtendedProjection_AndIsReportedOnTheResult()
    {
        var client = new SearchClient();
        client.ByName.Add(Row("GOODFAR", "GOOD FARM"));

        var read = await Sut(client, Config(extended: true)).SearchAsync("good", CancellationToken.None);

        Assert.Contains(CtrmCustomerQueries.ExtendedFieldsProjection, Assert.Single(client.Calls).Document);
        Assert.True(read.Value!.ExtendedFields);
    }

    [Fact]
    public async Task BlankTerm_SendsNothing_AndReturnsEmpty()
    {
        var client = new SearchClient();

        var read = await Sut(client).SearchAsync("  , ", CancellationToken.None);

        Assert.True(read.Ok);
        Assert.Empty(read.Value!.Items);
        Assert.Empty(client.Calls);
    }

    [Fact]
    public async Task PartialAnswer_IsAQueryError_NotAShorterList()
    {
        var client = new SearchClient
        {
            Answer = new()
            {
                Status = CtrmReadStatus.PartialSuccess, HttpStatus = 200, Detail = "alias errored",
                Value = new Dictionary<string, CtrmPage<CtrmCustomerDto>> { ["byName"] = new() { Items = [Row("GOODFAR", "GOOD FARM")] } }
            }
        };

        var read = await Sut(client).SearchAsync("good", CancellationToken.None);

        Assert.False(read.Ok);
        Assert.Equal(CtrmReadStatus.QueryError, read.Status);
        Assert.Null(read.Value);
    }

    [Fact]
    public async Task GatewayFailure_IsPropagated()
    {
        var client = new SearchClient { Answer = new() { Status = CtrmReadStatus.Throttled, HttpStatus = 429, Detail = "stub 429" } };

        var read = await Sut(client).SearchAsync("good", CancellationToken.None);

        Assert.False(read.Ok);
        Assert.Equal(CtrmReadStatus.Throttled, read.Status);
    }
}
