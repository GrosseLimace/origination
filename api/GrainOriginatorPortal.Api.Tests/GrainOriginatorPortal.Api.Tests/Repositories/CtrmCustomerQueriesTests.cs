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
    [InlineData(nameof(CtrmCustomerQueries.CustomersBySourceCodes))]
    [InlineData(nameof(CtrmCustomerQueries.CustomersBySourceCodesExtended))]
    public void Documents_ContainNoHashCommentLines(string constName)
    {
        var field = typeof(CtrmCustomerQueries).GetField(constName, BindingFlags.Public | BindingFlags.Static)!;
        var value = (string)field.GetRawConstantValue()!;

        Assert.DoesNotContain('#', value);
    }

    [Fact]
    public void CustomersBySourceCodes_FiltersByTheCodesListVariable_PagesWithSkipTake_AndCarriesTheProjection()
    {
        var document = CtrmCustomerQueries.CustomersBySourceCodes;

        Assert.StartsWith("query (", document);
        Assert.Contains("$codes: [String!]", document);
        Assert.Contains("$sourceSystem: String", document);
        Assert.Contains("sourceCodes: $codes", document);
        Assert.Contains("sourceSystem: $sourceSystem", document);
        Assert.Contains("skip: $skip, take: $take", document);
        Assert.Contains("pageInfo { hasNextPage }", document);
        Assert.Contains("items { " + CtrmCustomerQueries.CustomerProjection + " }", document);
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

    // -------------------------------------------------------------------------------------------------
    // E1: the extended projection behind CustomerSync:CtrmExtendedFields

    [Fact]
    public void ExtendedCustomerProjection_IsTheBaseProjectionPlusTheThirteenFieldsSeenOn2026_10_06()
    {
        // Deliberate tripwire, as for the base projection: these thirteen names were listed by
        // GET /api/diagnostics/customer-sync/ctrm-capabilities on nonprod on 2026-10-06. duplicateYN
        // exists too but is search-only (E3), so it is NOT here.
        Assert.Equal(
            "merchandisingEmail extendedPrimaryPhone supplementalEmail extendedAddressLine1 extendedAddressLine2 extendedAddressLine3 extendedAddressLine4 extendedCity extendedStateProvince extendedPostalCode extendedCountry nopidNo paymentMethod",
            CtrmCustomerQueries.ExtendedFieldsProjection);
        Assert.Equal(
            "id code name sourceCode sourceSystem activeYN merchandisingName merchandisingAddressLine1 merchandisingAddressLine2 merchandisingCity merchandisingStateProvince merchandisingPostalCode merchandisingCountry merchandisingPhone industryCode1 industryCode2 industryCode3 mdmMasterRecord lastChangedUtc merchandisingEmail extendedPrimaryPhone supplementalEmail extendedAddressLine1 extendedAddressLine2 extendedAddressLine3 extendedAddressLine4 extendedCity extendedStateProvince extendedPostalCode extendedCountry nopidNo paymentMethod",
            CtrmCustomerQueries.ExtendedCustomerProjection);
        Assert.DoesNotContain("duplicateYN", CtrmCustomerQueries.ExtendedCustomerProjection);
    }

    [Fact]
    public void Projection_PicksTheBaseOrTheExtendedProjection()
    {
        Assert.Equal(CtrmCustomerQueries.CustomerProjection, CtrmCustomerQueries.Projection(extended: false));
        Assert.Equal(CtrmCustomerQueries.ExtendedCustomerProjection, CtrmCustomerQueries.Projection(extended: true));
    }

    [Fact]
    public void CustomersBySourceCodesAliased_Extended_CarriesTheExtendedProjectionOnEveryAlias()
    {
        var extended = CtrmCustomerQueries.CustomersBySourceCodesAliased(["A", "B"], null, extended: true);
        var standard = CtrmCustomerQueries.CustomersBySourceCodesAliased(["A", "B"], null);

        Assert.Equal(2, CountOf("items { " + CtrmCustomerQueries.ExtendedCustomerProjection + " }", extended));
        Assert.Equal(2, CountOf("items { " + CtrmCustomerQueries.CustomerProjection + " }", standard));
        Assert.DoesNotContain("merchandisingEmail", standard);
        Assert.Equal(standard, CtrmCustomerQueries.CustomersBySourceCodesAliased(["A", "B"], null, extended: false));
    }

    [Fact]
    public void CustomersBySourceCodesExtended_IsTheListDocumentWithTheExtendedProjection()
    {
        Assert.Equal(
            CtrmCustomerQueries.CustomersBySourceCodes.Replace(
                "items { " + CtrmCustomerQueries.CustomerProjection + " }",
                "items { " + CtrmCustomerQueries.ExtendedCustomerProjection + " }",
                StringComparison.Ordinal),
            CtrmCustomerQueries.CustomersBySourceCodesExtended);
        Assert.DoesNotContain("merchandisingEmail", CtrmCustomerQueries.CustomersBySourceCodes);
        Assert.Equal(CtrmCustomerQueries.CustomersBySourceCodes, CtrmCustomerQueries.CustomersBySourceCodesDocument(extended: false));
        Assert.Equal(CtrmCustomerQueries.CustomersBySourceCodesExtended, CtrmCustomerQueries.CustomersBySourceCodesDocument(extended: true));
    }

    [Theory]
    [InlineData("\"0123456789\"", "0123456789")]
    [InlineData("1234567890", "1234567890")]
    [InlineData("null", null)]
    public void CtrmCustomerDto_ReadsTheExtendedFields_AndNopidNoAsStringOrNumber(string nopidJson, string? expectedNopText)
    {
        var json = "{\"merchandisingEmail\":\"a@b.com\",\"extendedPrimaryPhone\":\"402\",\"supplementalEmail\":\"c@d.com\"," +
                   "\"extendedAddressLine1\":\"x1\",\"extendedAddressLine2\":\"x2\",\"extendedAddressLine3\":\"x3\",\"extendedAddressLine4\":\"x4\"," +
                   "\"extendedCity\":\"xc\",\"extendedStateProvince\":\"xs\",\"extendedPostalCode\":\"xp\",\"extendedCountry\":\"US\"," +
                   "\"nopidNo\":" + nopidJson + ",\"paymentMethod\":\"ACH\"}";

        var dto = JsonSerializer.Deserialize<CtrmCustomerDto>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;

        Assert.Equal("a@b.com", dto.MerchandisingEmail);
        Assert.Equal("402", dto.ExtendedPrimaryPhone);
        Assert.Equal("c@d.com", dto.SupplementalEmail);
        Assert.Equal(["x1", "x2", "x3", "x4"], new[] { dto.ExtendedAddressLine1, dto.ExtendedAddressLine2, dto.ExtendedAddressLine3, dto.ExtendedAddressLine4 });
        Assert.Equal("xc", dto.ExtendedCity);
        Assert.Equal("xs", dto.ExtendedStateProvince);
        Assert.Equal("xp", dto.ExtendedPostalCode);
        Assert.Equal("US", dto.ExtendedCountry);
        Assert.Equal("ACH", dto.PaymentMethod);
        Assert.Equal(expectedNopText, dto.NopidNoText);
    }

    [Fact]
    public void CtrmCustomerDto_WithoutTheExtendedFields_HasNoNopText()
    {
        var dto = JsonSerializer.Deserialize<CtrmCustomerDto>("{\"sourceCode\":\"S\"}", new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;

        Assert.Null(dto.NopidNoText);
        Assert.Null(dto.MerchandisingEmail);
    }

    private static int CountOf(string needle, string haystack)
    {
        var count = 0;
        for (var i = haystack.IndexOf(needle, StringComparison.Ordinal); i >= 0; i = haystack.IndexOf(needle, i + needle.Length, StringComparison.Ordinal))
            count++;
        return count;
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
