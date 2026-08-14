// System namespaces
using System.Text.Json;

// Project namespaces
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Json;

namespace GrainOriginatorPortal.Api.Tests.Json;

/// <summary>
/// ODS <c>date</c> columns are calendar dates at midnight with Kind=Unspecified. The app-wide
/// UtcDateTimeJsonConverter tags every DateTime with a 'Z', which makes the browser shift them by the
/// user's offset — a Central user saw 2023-10-09 render as 10/8/23. These tests pin the no-offset
/// serialization that keeps a calendar date on its intended day.
/// </summary>
public class CalendarDateJsonConverterTests
{
    private static readonly JsonSerializerOptions Options = BuildOptions();

    /// <summary>
    /// Mirrors Program.cs: web defaults (camelCase property names) plus the globally registered UTC
    /// converters, so these tests exercise the same precedence the API does.
    /// </summary>
    private static JsonSerializerOptions BuildOptions()
    {
        var o = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        o.Converters.Add(new UtcDateTimeJsonConverter());
        o.Converters.Add(new NullableUtcDateTimeJsonConverter());
        return o;
    }

    [Fact]
    public void WritesCalendarDateWithoutAnOffset()
    {
        var json = JsonSerializer.Serialize(new DpContractResponse
        {
            ChargedFromDate = new DateTime(2023, 10, 9),
        }, Options);

        // No trailing Z and no +/-hh:mm — the browser parses this as LOCAL midnight, so it renders as
        // 10/9 everywhere rather than sliding to 10/8 west of UTC.
        Assert.Contains("\"chargedFromDate\":\"2023-10-09T00:00:00\"", json);
        Assert.DoesNotContain("\"chargedFromDate\":\"2023-10-09T00:00:00Z\"", json);
    }

    [Fact]
    public void PropertyLevelConverterOverridesTheGlobalUtcConverter()
    {
        // Guards the mechanism itself: if the [JsonConverter] attribute were dropped, the global
        // converter would win and reintroduce the day shift.
        var json = JsonSerializer.Serialize(new DpContractResponse
        {
            ChargedThruDate = new DateTime(2024, 1, 31),
        }, Options);

        Assert.Contains("\"chargedThruDate\":\"2024-01-31T00:00:00\"", json);
    }

    [Fact]
    public void DropsAnyTimeComponent()
    {
        var json = JsonSerializer.Serialize(new DpContractResponse
        {
            BolDate = new DateTime(2023, 10, 9, 23, 45, 12),
        }, Options);

        Assert.Contains("\"bolDate\":\"2023-10-09T00:00:00\"", json);
    }

    [Fact]
    public void WritesNullForAMissingDate()
    {
        var json = JsonSerializer.Serialize(new DpContractResponse { PaidThruDate = null }, Options);

        Assert.Contains("\"paidThruDate\":null", json);
    }

    [Fact]
    public void RoundTripsToTheSameCalendarDay()
    {
        var original = new DpContractResponse { ChargedFromDate = new DateTime(2023, 10, 9) };

        var back = JsonSerializer.Deserialize<DpContractResponse>(
            JsonSerializer.Serialize(original, Options), Options);

        Assert.Equal(new DateTime(2023, 10, 9), back!.ChargedFromDate);
    }
}
