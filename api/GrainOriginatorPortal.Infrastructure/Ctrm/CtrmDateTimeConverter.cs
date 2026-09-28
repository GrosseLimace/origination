using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Reads the date and timestamp shapes the CTRM API actually emits.
/// </summary>
/// <remarks>
/// <para>System.Text.Json only accepts ISO 8601 — <c>2026-08-01T00:32:53</c> — and throws on anything
/// else. CTRM's <c>Date</c> scalar is fine (<c>2026-07-30</c>), but its timestamp fields come back
/// space-separated: <c>lastActivityTimestamp</c> is <c>"2026-08-01 00:32:53"</c>. That is a valid
/// SQL/Db2 timestamp rendering and not valid ISO 8601, so the strict reader fails the entire
/// response — one unparseable field on one price line took down the whole contracts read.</para>
///
/// <para>Parsing is deliberately permissive on input and unambiguous on output. Being strict here buys
/// nothing: we do not control the wire format, and the alternative to accepting it is failing the
/// request.</para>
/// </remarks>
public sealed class CtrmDateTimeConverter : JsonConverter<DateTime>
{
    /// <summary>
    /// Formats tried before falling back to a general parse. Listed explicitly because
    /// <see cref="DateTime.TryParse(string, IFormatProvider, DateTimeStyles, out DateTime)"/> alone
    /// would also accept locale-dependent readings, and these are the shapes actually observed.
    /// </summary>
    private static readonly string[] Formats =
    [
        "yyyy-MM-dd HH:mm:ss",          // observed on lastActivityTimestamp
        "yyyy-MM-dd HH:mm:ss.fff",
        "yyyy-MM-dd HH:mm:ss.ffffff",
        "yyyy-MM-dd HH:mm:ss.fffffff",
        "yyyy-MM-dd-HH.mm.ss",          // Db2's own native timestamp rendering
        "yyyy-MM-dd-HH.mm.ss.ffffff",
        "yyyy-MM-dd"                    // the Date scalar
    ];

    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        => TryReadValue(ref reader, out var value)
            ? value
            : throw new JsonException(
                $"Could not read a CTRM date/timestamp from '{reader.GetString()}'. Expected ISO 8601, "
                + "'yyyy-MM-dd HH:mm:ss' or 'yyyy-MM-dd'.");

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
        => writer.WriteStringValue(value.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture));

    /// <summary>Shared by the nullable converter so both accept exactly the same inputs.</summary>
    internal static bool TryReadValue(ref Utf8JsonReader reader, out DateTime value)
    {
        value = default;

        // Some fields arrive as a real ISO string the built-in reader handles; try that first so we
        // do not lose offset information it would have preserved.
        if (reader.TokenType == JsonTokenType.String && reader.TryGetDateTime(out var iso))
        {
            value = iso;
            return true;
        }

        if (reader.TokenType != JsonTokenType.String) return false;

        var raw = reader.GetString();
        if (string.IsNullOrWhiteSpace(raw)) return false;

        raw = raw.Trim();

        return DateTime.TryParseExact(raw, Formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out value)
            || DateTime.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.None, out value);
    }
}

/// <summary>
/// Nullable counterpart to <see cref="CtrmDateTimeConverter"/>.
/// </summary>
/// <remarks>
/// Every date on the CTRM DTOs is nullable, so this is the one that does the real work. An empty or
/// unparseable string becomes null rather than an exception: a single malformed date on one row is not
/// worth failing a whole page of contracts over, and the sentinel normalization downstream already
/// treats a missing date as absent.
/// </remarks>
public sealed class CtrmNullableDateTimeConverter : JsonConverter<DateTime?>
{
    public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null) return null;
        return CtrmDateTimeConverter.TryReadValue(ref reader, out var value) ? value : null;
    }

    public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
    {
        if (value is null) writer.WriteNullValue();
        else writer.WriteStringValue(value.Value.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture));
    }
}
