// System namespaces
using System.Text.Json;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Covers the date/timestamp shapes the CTRM API emits.
/// </summary>
/// <remarks>
/// This exists because of a real failure: <c>lastActivityTimestamp</c> arrives space-separated
/// ("2026-08-01 00:32:53"), System.Text.Json's reader accepts only ISO 8601, and one such value on one
/// price line failed an entire page of contracts with an HTTP 500.
/// </remarks>
public class CtrmDateTimeConverterTests
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new CtrmNullableDateTimeConverter(), new CtrmDateTimeConverter() }
    };

    private static DateTime? Parse(string json) =>
        JsonSerializer.Deserialize<CtrmContractPriceDto>(
            $$"""{"lastActivityTimestamp": {{json}}}""", Options)!.LastActivityTimestamp;

    // -------------------------------------------------------------------------
    [Fact]
    public void SpaceSeparatedTimestamp_IsAccepted()
    {
        // The exact value that broke the contracts read.
        Assert.Equal(new DateTime(2026, 8, 1, 0, 32, 53), Parse("\"2026-08-01 00:32:53\""));
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("\"2026-08-01T00:32:53\"", 2026, 8, 1, 0, 32, 53)]      // real ISO 8601
    [InlineData("\"2026-07-30\"", 2026, 7, 30, 0, 0, 0)]                 // the Date scalar
    [InlineData("\"2026-08-01-00.32.53\"", 2026, 8, 1, 0, 32, 53)]       // Db2 native rendering
    [InlineData("\"  2026-07-30  \"", 2026, 7, 30, 0, 0, 0)]             // padded
    public void SupportedShapes_AreAllAccepted(string json, int y, int mo, int d, int h, int mi, int s)
    {
        Assert.Equal(new DateTime(y, mo, d, h, mi, s), Parse(json));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void FractionalSeconds_ArePreserved_NotTruncated()
    {
        Assert.Equal(new DateTime(2026, 8, 1, 0, 32, 53).AddMilliseconds(123),
            Parse("\"2026-08-01 00:32:53.123\""));
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("null")]
    [InlineData("\"\"")]
    [InlineData("\"   \"")]
    [InlineData("\"not a date\"")]
    public void NullOrUnparseable_BecomesNull_RatherThanFailingTheWholePage(string json)
    {
        // One bad date on one row is not worth losing every contract in the response, and the sentinel
        // normalization downstream already treats a missing date as absent.
        Assert.Null(Parse(json));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void TheDb2MinDateSentinel_SurvivesParsing_SoMappingCanNormalizeIt()
    {
        // The converter must NOT swallow 0001-01-01 — CtrmMappings.NullIfSentinel is what turns it into
        // null, and it can only do that if the value arrives intact.
        Assert.Equal(new DateTime(1, 1, 1), Parse("\"0001-01-01\""));
        Assert.Null(CtrmMappings.NullIfSentinel(Parse("\"0001-01-01\"")));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void ContractDatesRoundTripThroughAFullResponseShape()
    {
        // Guards the whole envelope, not just one field — this is the path that actually broke.
        const string json = """
            {
              "contracts": {
                "totalCount": 1,
                "pageInfo": { "skip": 0, "take": 1, "hasNextPage": false, "hasPreviousPage": false },
                "items": [{
                  "contractId": "PWW227420",
                  "contractPrefixType": "P",
                  "customerId": "TATOBIN",
                  "contractDate": "2026-03-20",
                  "closedDate": "0001-01-01",
                  "quantity": 1000.000,
                  "prices": [{
                    "priceSequence": 0,
                    "flatPrice": 5.62,
                    "priceDate": "2026-07-30",
                    "lastActivityTimestamp": "2026-08-01 00:32:53"
                  }]
                }]
              }
            }
            """;

        var response = JsonSerializer.Deserialize<CtrmContractsResponse>(json, Options);

        var contract = Assert.Single(response!.Contracts!.Items);
        Assert.Equal(new DateTime(2026, 3, 20), contract.ContractDate);
        var price = Assert.Single(contract.Prices);
        Assert.Equal(new DateTime(2026, 8, 1, 0, 32, 53), price.LastActivityTimestamp);

        // And the mapped entity comes out with the sentinel normalized away.
        var mapped = Assert.Single(CtrmMappings.ToContracts([contract], new DateTime(2026, 8, 10)));
        Assert.Null(mapped.ClosedDate);
    }
}
