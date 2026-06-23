using System.Text.Json;
using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Json;

/// <summary>
/// Forces DateTime values to serialize as UTC ISO 8601 strings (with the trailing 'Z').
///
/// Why: every persisted DateTime in this app is set via DateTime.UtcNow, but EF Core reads
/// the column back with Kind=Unspecified. System.Text.Json's default DateTime writer emits
/// the offset that matches Kind — so Unspecified produces "2026-05-07T15:19:00" with no
/// suffix. Browsers then parse that as local time, which shifts displayed timestamps by the
/// user's UTC offset (e.g. a CST user sees a 10:19 AM note as 3:19 PM).
///
/// On read, we accept any standard ISO format (with or without Z/offset) and normalize the
/// result to UTC for downstream comparisons.
/// </summary>
public sealed class UtcDateTimeJsonConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var value = reader.GetDateTime();
        return value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
        };
    }

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
    {
        var utc = value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);
        // "o" — ISO 8601 round-trip format. Always ends with Z when Kind=Utc.
        writer.WriteStringValue(utc.ToString("o"));
    }
}

/// <summary>Same treatment for nullable DateTime?.</summary>
public sealed class NullableUtcDateTimeJsonConverter : JsonConverter<DateTime?>
{
    public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null) return null;
        var value = reader.GetDateTime();
        return value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
        };
    }

    public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
    {
        if (value is null) { writer.WriteNullValue(); return; }
        var utc = value.Value.Kind == DateTimeKind.Utc ? value.Value : DateTime.SpecifyKind(value.Value, DateTimeKind.Utc);
        writer.WriteStringValue(utc.ToString("o"));
    }
}
