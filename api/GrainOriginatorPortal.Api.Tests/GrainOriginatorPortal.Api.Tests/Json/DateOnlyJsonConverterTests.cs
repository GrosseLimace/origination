// System namespaces
using System.Text.Json;
using System.Text.Json.Serialization;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Json;

namespace GrainOriginatorPortal.Api.Tests.Json;

/// <summary>
/// ODS ship/contract dates are SQL <c>date</c> columns — a calendar date with no time-of-day and
/// no zone. The app-wide UTC converter stamps every DateTime with a 'Z', and a browser west of UTC
/// then rolls that back a day (2026-07-01 renders as 6/30). This converter opts a single property
/// out of the UTC treatment; these tests pin that, because the bug it prevents already shipped once.
///
/// CalendarDateJsonConverterTests covers it through a real response DTO. These go at the converter
/// directly so the Kind-stripping branches are exercised in isolation.
/// </summary>
public class DateOnlyJsonConverterTests
{
    private sealed class Holder
    {
        [JsonConverter(typeof(DateOnlyJsonConverter))]
        public DateTime? ShipDate { get; set; }
    }

    /// <summary>Mirrors Program.cs: the global UTC converters are registered, so these tests also
    /// prove the per-property attribute still wins over them.</summary>
    private static JsonSerializerOptions BuildOptions()
    {
        var o = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        o.Converters.Add(new UtcDateTimeJsonConverter());
        o.Converters.Add(new NullableUtcDateTimeJsonConverter());
        return o;
    }

    private static readonly JsonSerializerOptions Options = BuildOptions();

    // -------------------------------------------------------------------------
    [Fact]
    public void Write_OmitsTheZoneDesignator()
    {
        var json = JsonSerializer.Serialize(new Holder { ShipDate = new DateTime(2026, 7, 1) }, Options);

        Assert.Contains("\"shipDate\":\"2026-07-01T00:00:00\"", json);
        // The 'Z' is what caused the day to slide — it must not come back.
        Assert.DoesNotContain("Z\"", json);
    }

    [Fact]
    public void Write_BeatsTheGloballyRegisteredUtcConverter()
    {
        // Precedence check: the property attribute has to override the global nullable UTC
        // converter, or every calendar date silently reverts to the shifting behaviour.
        var json = JsonSerializer.Serialize(new Holder { ShipDate = new DateTime(2026, 7, 1) }, Options);

        Assert.DoesNotContain("2026-07-01T00:00:00.0000000Z", json);
    }

    [Theory]
    [InlineData(DateTimeKind.Utc)]
    [InlineData(DateTimeKind.Unspecified)]
    [InlineData(DateTimeKind.Local)]
    public void Write_KeepsTheCalendarDate_WhateverTheKind(DateTimeKind kind)
    {
        // Whichever Kind EF or a mapper happens to attach, the emitted DAY must not move.
        var json = JsonSerializer.Serialize(
            new Holder { ShipDate = new DateTime(2026, 7, 1, 0, 0, 0, kind) }, Options);

        Assert.Contains("\"shipDate\":\"2026-07-01T00:00:00\"", json);
    }

    [Fact]
    public void Write_DropsAnyTimeOfDay()
    {
        // These columns are dates; a stray time component would render inconsistently.
        var json = JsonSerializer.Serialize(
            new Holder { ShipDate = new DateTime(2026, 7, 1, 13, 45, 30) }, Options);

        Assert.Contains("\"shipDate\":\"2026-07-01T13:45:30\"", json);
        Assert.DoesNotContain("Z\"", json);
    }

    [Fact]
    public void Write_EmitsNullForNull()
    {
        var json = JsonSerializer.Serialize(new Holder { ShipDate = null }, Options);

        Assert.Contains("\"shipDate\":null", json);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void Read_StripsTheZoneAndKeepsTheDate()
    {
        var result = JsonSerializer.Deserialize<Holder>("""{"shipDate":"2026-07-01T00:00:00"}""", Options);

        Assert.Equal(new DateTime(2026, 7, 1), result!.ShipDate);
        Assert.Equal(DateTimeKind.Unspecified, result.ShipDate!.Value.Kind);
    }

    [Fact]
    public void Read_TruncatesToTheDatePart()
    {
        var result = JsonSerializer.Deserialize<Holder>("""{"shipDate":"2026-07-01T13:45:30"}""", Options);

        Assert.Equal(new DateTime(2026, 7, 1), result!.ShipDate);
    }

    [Fact]
    public void Read_ReturnsNullForNull()
    {
        var result = JsonSerializer.Deserialize<Holder>("""{"shipDate":null}""", Options);

        Assert.Null(result!.ShipDate);
    }

    [Fact]
    public void RoundTrip_KeepsTheSameDay()
    {
        var original = new DateTime(2026, 7, 1);

        var json = JsonSerializer.Serialize(new Holder { ShipDate = original }, Options);
        var back = JsonSerializer.Deserialize<Holder>(json, Options)!.ShipDate;

        Assert.Equal(original.Date, back!.Value.Date);
        // And a second pass produces identical JSON, so a value can't creep across repeated hops.
        Assert.Equal(json, JsonSerializer.Serialize(new Holder { ShipDate = back }, Options));
    }
}
