namespace GrainOriginatorPortal.Api.Middleware;

/// <summary>
/// Makes a request-supplied string safe to place in a log line or log scope.
/// </summary>
/// <remarks>
/// <para>ASP.NET Core URL-decodes the request path before middleware sees it, so a request for
/// <c>/api/x%0D%0A2026-01-01 WARN Access denied</c> arrives as a path containing a carriage return and a
/// line feed. Written verbatim into a plain-text sink, that forges a second log line (CWE-117; QA scan
/// 2026-09-30, two findings). The same applies to any token claim that is echoed into a log, since the
/// claim text is chosen by whoever minted the token.</para>
///
/// <para>The deployed sink is Application Insights, which stores each record as a structured document, so
/// a newline inside a property value cannot split a record there. The local console sink CAN be split,
/// and Security treats the 401/403 audit lines as authoritative, so the values are cleaned at the point
/// they enter the log rather than relying on every sink to escape them.</para>
///
/// <para>Rules: every control character (which includes CR, LF, TAB and ESC) becomes a space, and the
/// result is cut to <paramref name="maxLength"/> characters. Nothing else is changed, so a genuine path
/// stays readable and searchable. The correlation id does not come through here: it is validated to a
/// character allow-list by <see cref="CorrelationIdMiddleware"/> before it is accepted at all.</para>
/// </remarks>
public static class LogSanitizer
{
    /// <summary>Default cap. A real route in this API is under 200 characters; anything longer is noise.</summary>
    public const int DefaultMaxLength = 256;

    public static string? Clean(string? value, int maxLength = DefaultMaxLength)
    {
        if (string.IsNullOrEmpty(value)) return value;

        var length = Math.Min(value.Length, maxLength);
        var needsCopy = value.Length > maxLength;
        for (var i = 0; i < length && !needsCopy; i++)
            if (char.IsControl(value[i])) needsCopy = true;
        if (!needsCopy) return value;

        var buffer = new char[length];
        for (var i = 0; i < length; i++)
        {
            var c = value[i];
            buffer[i] = char.IsControl(c) ? ' ' : c;
        }
        return new string(buffer);
    }
}
