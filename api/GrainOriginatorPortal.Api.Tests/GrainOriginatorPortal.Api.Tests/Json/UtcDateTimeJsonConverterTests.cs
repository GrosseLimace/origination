// System namespaces
using System.Text.Json;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Json;

namespace GrainOriginatorPortal.Api.Tests.Json;

/// <summary>
/// Every persisted DateTime in this app is written via DateTime.UtcNow, but EF Core reads the
/// column back with Kind=Unspecified — and System.Text.Json emits the offset that matches Kind, so
/// Unspecified serialises with no suffix and browsers parse it as LOCAL time. That shifted every
/// displayed timestamp by the user's offset (a Central user saw a 10:19 AM note as 3:19 PM), which
/// is the bug this converter exists to prevent.
///
/// The sibling CalendarDateJsonConverterTests pinned the date-only case; these pin the timestamp
/// case, so a future edit to the Kind-normalisation branches can't quietly reintroduce the shift.
/// </summary>
public class UtcDateTimeJsonConverterTests
{
    private sealed class Holder
    {
        public DateTime When { get; set; }
    }

    private sealed class NullableHolder
    {
        public DateTime? When { get; set; }
    }

    /// <summary>Mirrors Program.cs — web defaults plus the globally registered UTC converters.</summary>
    private static JsonSerializerOptions BuildOptions()
    {
        var o = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        o.Converters.Add(new UtcDateTimeJsonConverter());
        o.Converters.Add(new NullableUtcDateTimeJsonConverter());
        return o;
    }

    private static readonly JsonSerializerOptions Options = BuildOptions();

    // -------------------------------------------------------------------------
    // Write — the 'Z' is the whole point.
    // -------------------------------------------------------------------------

    [Fact]
    public void Write_StampsUnspecifiedKindAsUtc()
    {
        // The EF-read case: Kind=Unspecified, already holding a UTC instant.
        var json = JsonSerializer.Serialize(
            new Holder { When = new DateTime(2026, 5, 7, 15, 19, 0, DateTimeKind.Unspecified) }, Options);

        // Must end with Z. Without it the browser treats 15:19 as local and the note jumps hours.
        Assert.Contains("\"when\":\"2026-05-07T15:19:00.0000000Z\"", json);
    }

    [Fact]
    public void Write_KeepsUtcKindUnchanged()
    {
        var json = JsonSerializer.Serialize(
            new Holder { When = new DateTime(2026, 5, 7, 15, 19, 0, DateTimeKind.Utc) }, Options);

        Assert.Contains("\"when\":\"2026-05-07T15:19:00.0000000Z\"", json);
    }

    [Fact]
    public void Write_TreatsLocalKindAsAlreadyUtc_RatherThanConvertingIt()
    {
        // Deliberate asymmetry with Read: Write re-labels rather than converts. Every value
        // reaching the writer came from DateTime.UtcNow or the DB, so a Local Kind means the Kind
        // is wrong, not the clock reading — converting would shift a correct instant.
        var json = JsonSerializer.Serialize(
            new Holder { When = new DateTime(2026, 5, 7, 15, 19, 0, DateTimeKind.Local) }, Options);

        // The wall-clock digits survive; only the marker is added.
        Assert.Contains("\"when\":\"2026-05-07T15:19:00.0000000Z\"", json);
    }

    [Fact]
    public void Write_EmitsNullForNullableNull()
    {
        var json = JsonSerializer.Serialize(new NullableHolder { When = null }, Options);

        Assert.Contains("\"when\":null", json);
    }

    [Fact]
    public void Write_StampsNullableValueAsUtc()
    {
        var json = JsonSerializer.Serialize(
            new NullableHolder { When = new DateTime(2026, 5, 7, 15, 19, 0, DateTimeKind.Unspecified) }, Options);

        Assert.Contains("\"when\":\"2026-05-07T15:19:00.0000000Z\"", json);
    }

    // -------------------------------------------------------------------------
    // Read — normalise to UTC so downstream comparisons are apples to apples.
    // -------------------------------------------------------------------------

    [Fact]
    public void Read_KeepsAnExplicitZAsUtc()
    {
        var result = JsonSerializer.Deserialize<Holder>("""{"when":"2026-05-07T15:19:00Z"}""", Options);

        Assert.Equal(DateTimeKind.Utc, result!.When.Kind);
        Assert.Equal(new DateTime(2026, 5, 7, 15, 19, 0), result.When);
    }

    [Fact]
    public void Read_LabelsAZonelessValueAsUtc_WithoutMovingTheClock()
    {
        var result = JsonSerializer.Deserialize<Holder>("""{"when":"2026-05-07T15:19:00"}""", Options);

        Assert.Equal(DateTimeKind.Utc, result!.When.Kind);
        Assert.Equal(15, result.When.Hour);   // not shifted by the test machine's offset
    }

    [Fact]
    public void Read_ConvertsAnExplicitOffsetToUtc()
    {
        // An offset IS real zone information, so here the clock SHOULD move: 10:19-05:00 = 15:19Z.
        var result = JsonSerializer.Deserialize<Holder>("""{"when":"2026-05-07T10:19:00-05:00"}""", Options);

        Assert.Equal(DateTimeKind.Utc, result!.When.Kind);
        Assert.Equal(new DateTime(2026, 5, 7, 15, 19, 0), result.When);
    }

    [Fact]
    public void Read_ReturnsNullForNull()
    {
        var result = JsonSerializer.Deserialize<NullableHolder>("""{"when":null}""", Options);

        Assert.Null(result!.When);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void RoundTrip_IsStableAcrossEveryKind()
    {
        foreach (var kind in new[] { DateTimeKind.Utc, DateTimeKind.Unspecified, DateTimeKind.Local })
        {
            var original = new DateTime(2026, 5, 7, 15, 19, 0, kind);

            var json = JsonSerializer.Serialize(new Holder { When = original }, Options);
            var back = JsonSerializer.Deserialize<Holder>(json, Options)!.When;

            // Serialising again must produce identical JSON — otherwise a value drifts a little
            // further every time it passes through the API.
            var json2 = JsonSerializer.Serialize(new Holder { When = back }, Options);
            Assert.Equal(json, json2);
            Assert.Equal(DateTimeKind.Utc, back.Kind);
        }
    }
}
