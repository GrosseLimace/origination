using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Json;

/// <summary>
/// Serializes a CALENDAR DATE (no meaningful time-of-day) so browsers render the same day the source
/// system reported.
///
/// Why this exists alongside <see cref="UtcDateTimeJsonConverter"/>: that converter is correct for
/// stored timestamps — they're written with DateTime.UtcNow and must carry a 'Z' so the browser can
/// localize them. But ODS <c>date</c> columns are calendar dates at midnight with Kind=Unspecified.
/// Tagging those as UTC makes the browser shift them by the user's offset, so a Central user sees
/// <c>2023-10-09</c> as <c>10/8/23</c> — a full day early on every date in the row.
///
/// Writing "2023-10-09T00:00:00" with NO offset makes JS parse it as LOCAL midnight, which renders as
/// the intended day in every timezone. (A bare "2023-10-09" would NOT work: JS parses date-only
/// strings as UTC, reintroducing the same shift.)
///
/// Apply per-property with <c>[JsonConverter(typeof(CalendarDateJsonConverter))]</c> — a property-level
/// attribute takes precedence over the globally registered converters.
/// </summary>
public sealed class CalendarDateJsonConverter : JsonConverter<DateTime?>
{
    private const string Format = "yyyy-MM-dd'T'HH:mm:ss";

    public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null) return null;
        var value = reader.GetDateTime();
        // Strip any offset interpretation — a calendar date has no zone.
        return DateTime.SpecifyKind(value.Date, DateTimeKind.Unspecified);
    }

    public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
    {
        if (value is null) { writer.WriteNullValue(); return; }
        // Date component only, no 'Z' and no offset.
        writer.WriteStringValue(value.Value.Date.ToString(Format, CultureInfo.InvariantCulture));
    }
}
