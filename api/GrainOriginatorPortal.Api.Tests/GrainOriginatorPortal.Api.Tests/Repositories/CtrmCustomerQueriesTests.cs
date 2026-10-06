// System namespaces
using System.Reflection;
using System.Text.Json;

// Third-party namespaces
using Xunit;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

public class CtrmCustomerQueriesTests
{
    [Fact]
    public void CustomersBySourceCodesAliased_BuildsOneAliasPerCode_WithJsonSerialisedCodes()
    {
        var document = CtrmCustomerQueries.CustomersBySourceCodesAliased(["TATOBIN", "O'HARA1"], null);

        Assert.StartsWith("query {", document);
        Assert.Contains("c0: customers(skip: 0, take: 5, sourceCode: \"TATOBIN\")", document);
        Assert.Contains("c1: customers(skip: 0, take: 5, sourceCode: \"O'HARA1\")", document);
        Assert.Contains(CtrmCustomerQueries.CustomerProjection, document);
    }

    [Fact]
    public void CustomersBySourceCodesAliased_WithSourceSystem_AddsTheArgument()
    {
        var document = CtrmCustomerQueries.CustomersBySourceCodesAliased(["TATOBIN"], "CTRM");

        Assert.Contains(", sourceSystem: \"CTRM\")", document);
    }

    [Fact]
    public void CustomersBySourceCodesAliased_EscapesQuotesInCodes()
    {
        var document = CtrmCustomerQueries.CustomersBySourceCodesAliased(["A\"B"], null);

        Assert.Contains("sourceCode: \"A\\\"B\"", document);
    }

    [Fact]
    public void CustomersBySourceCodesAliased_WithNoCodes_Throws()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => CtrmCustomerQueries.CustomersBySourceCodesAliased([], null));
    }

    [Theory]
    [InlineData(nameof(CtrmCustomerQueries.ContractLinksInWindow))]
    [InlineData(nameof(CtrmCustomerQueries.TicketLinksInWindow))]
    [InlineData(nameof(CtrmCustomerQueries.CustomersProbe))]
    public void Documents_ContainNoHashCommentLines(string constName)
    {
        var field = typeof(CtrmCustomerQueries).GetField(constName, BindingFlags.Public | BindingFlags.Static)!;
        var value = (string)field.GetRawConstantValue()!;

        Assert.DoesNotContain('#', value);
    }

    [Fact]
    public void CustomersBySourceCodesAliased_ContainsNoHash()
    {
        var document = CtrmCustomerQueries.CustomersBySourceCodesAliased(["A", "B"], "CTRM");

        Assert.DoesNotContain('#', document);
    }

    [Fact]
    public void CustomerProjection_NamesOnlyFieldsConfirmedOn2026_10_05()
    {
        // Deliberate tripwire: an unknown field makes the whole query fail with HTTP 400, so adding
        // a field must be a conscious act against the API team's confirmed list.
        Assert.Equal(
            "id code name sourceCode sourceSystem activeYN merchandisingName merchandisingAddressLine1 merchandisingAddressLine2 merchandisingCity merchandisingStateProvince merchandisingPostalCode merchandisingCountry merchandisingPhone industryCode1 industryCode2 industryCode3 mdmMasterRecord lastChangedUtc",
            CtrmCustomerQueries.CustomerProjection);
    }

    [Theory]
    [InlineData("true", true)]
    [InlineData("\"Y\"", true)]
    [InlineData("\"n\"", false)]
    [InlineData("false", false)]
    [InlineData("1", true)]
    public void CtrmYesNo_IsYes_AcceptsBoolTrueAndYStrings(string json, bool expected)
    {
        using var doc = JsonDocument.Parse(json);

        Assert.Equal(expected, CtrmYesNo.IsYes(doc.RootElement));
    }

    [Fact]
    public void CtrmCustomerDto_IdText_ReadsNumberAndString()
    {
        var numeric = JsonSerializer.Deserialize<CtrmCustomerDto>("{\"id\":42}", new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        var text = JsonSerializer.Deserialize<CtrmCustomerDto>("{\"id\":\"abc\"}", new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

        Assert.Equal("42", numeric.IdText);
        Assert.Equal("abc", text.IdText);
    }
}
