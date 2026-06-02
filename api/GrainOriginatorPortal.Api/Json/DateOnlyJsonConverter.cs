using System.Text.Json;
using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Api.Json;

/// <summary>
/// Serializes calendar-date fields (ODS date-only columns like StartShipDate / FinalShipDate /
/// ContractDate / ClosedDate) WITHOUT a UTC marker, so the browser reads them as a plain local
/// date and never time-shifts them.
///
/// Why this exists: the app-wide <see cref="NullableUtcDateTimeJsonConverter"/> stamps every
/// DateTime as UTC (correct for real timestamps written via DateTime.UtcNow). But ODS ship/
/// contract dates are calendar dates with no time-of-day or zone — a SQL `date`. Marking those
/// UTC and rendering them in a negative-offset zone (e.g. CST) rolls them back a day
/// (2026-07-01 -> 6/30). Emitting "2026-07-01T00:00:00" (no 'Z') makes browsers parse it as
/// local midnight, so the date part is stable in every time zone.
///
/// Apply per-property with [JsonConverter(typeof(DateOnlyJsonConverter))]; it overrides the
/// global UTC converter for just that field.
/// </summary>
public sealed class DateOnlyJsonConverter : JsonConverter<DateTime?>
{
    private const string Format = "yyyy-MM-dd'T'HH:mm:ss"; // ISO, no zone designator

    public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null) return null;
        // Treat the incoming value as a plain date — strip any zone so it round-trips unshifted.
        return DateTime.SpecifyKind(reader.GetDateTime(), DateTimeKind.Unspecified).Date;
    }

    public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
    {
        if (value is null) { writer.WriteNullValue(); return; }
        // Date part only, no 'Z' — the browser keeps the calendar date regardless of its time zone.
        writer.WriteStringValue(value.Value.ToString(Format));
    }
}
