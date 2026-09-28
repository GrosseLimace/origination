// System namespaces
using System.Text.Json;

// Project namespaces
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Json;

namespace GrainOriginatorPortal.Api.Tests.Json;

/// <summary>
/// ContractResponse's four dates already carried DateOnlyJsonConverter, but the pricing line's
/// PriceDate and the ticket's settled/parsed dates did not — so the global UTC converter stamped
/// them with a 'Z' and a Central user saw a pricing line dated a day early while the contract
/// header beside it read correctly. These tests pin every contract/ticket calendar date to the
/// no-offset form and would fail if the attribute were dropped again.
/// </summary>
public class ContractTicketCalendarDateTests
{
    private static readonly JsonSerializerOptions Options = BuildOptions();

    private static JsonSerializerOptions BuildOptions()
    {
        var o = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        o.Converters.Add(new UtcDateTimeJsonConverter());
        o.Converters.Add(new NullableUtcDateTimeJsonConverter());
        return o;
    }

    [Fact]
    public void PricingLinePriceDateKeepsItsCalendarDay()
    {
        var json = JsonSerializer.Serialize(
            new ContractPricingLineResponse { PriceDate = new DateTime(2026, 5, 18) }, Options);

        Assert.Contains("\"priceDate\":\"2026-05-18T00:00:00\"", json);
        Assert.DoesNotContain("2026-05-18T00:00:00Z", json);
    }

    [Fact]
    public void TicketSettledAndParsedDatesKeepTheirCalendarDay()
    {
        var json = JsonSerializer.Serialize(new TicketResponse
        {
            Date = "2026-05-18",
            FinalSettledDate = new DateTime(2026, 5, 18),
            // On the response record ParsedDate is a plain property the mapper copies from the
            // entity, not the entity's computed one - so it must be set here.
            ParsedDate = new DateTime(2026, 5, 18),
        }, Options);

        Assert.Contains("\"finalSettledDate\":\"2026-05-18T00:00:00\"", json);
        Assert.Contains("\"parsedDate\":\"2026-05-18T00:00:00\"", json);
        Assert.DoesNotContain("2026-05-18T00:00:00Z", json);
    }

    [Fact]
    public void ContractHeaderDatesAgreeWithThePricingLineBesideThem()
    {
        // The reported symptom was a mismatch WITHIN one screen: the contract header read 5/18 and
        // its pricing line read 5/17. Same instant in, same string out, is the invariant.
        var day = new DateTime(2026, 5, 18);
        var header = JsonSerializer.Serialize(new ContractResponse { ContractDate = day }, Options);
        var line = JsonSerializer.Serialize(new ContractPricingLineResponse { PriceDate = day }, Options);

        Assert.Contains("\"contractDate\":\"2026-05-18T00:00:00\"", header);
        Assert.Contains("\"priceDate\":\"2026-05-18T00:00:00\"", line);
    }

    [Fact]
    public void NullCalendarDatesStayNull()
    {
        var json = JsonSerializer.Serialize(new ContractPricingLineResponse { PriceDate = null }, Options);
        Assert.Contains("\"priceDate\":null", json);
    }
}
