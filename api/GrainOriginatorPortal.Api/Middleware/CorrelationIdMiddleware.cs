// System namespaces
using System.Diagnostics;

namespace GrainOriginatorPortal.Api.Middleware;

/// <summary>
/// Generates or propagates a correlation ID (traceId) for every inbound request.
/// Reads X-Correlation-Id from the request header when provided by an upstream caller;
/// otherwise falls back to the current Activity TraceId or a new GUID.
/// The resolved ID is written back to the response header and stored in HttpContext.Items
/// for use in error responses and structured log entries.
/// </summary>
public class CorrelationIdMiddleware
{
    public const string HeaderName = "X-Correlation-Id";
    public const string ItemsKey = "CorrelationId";

    /// <summary>Upper bound on an accepted inbound correlation id — comfortably fits a GUID or a
    /// W3C trace id, short enough that it can't bloat every log line it lands in.</summary>
    internal const int MaxLength = 64;

    private readonly RequestDelegate _next;

    public CorrelationIdMiddleware(RequestDelegate next) => _next = next;

    // -------------------------------------------------------------------------
    public async Task InvokeAsync(HttpContext context)
    {
        var inbound = context.Request.Headers[HeaderName].FirstOrDefault();

        var correlationId = IsWellFormed(inbound)
            ? inbound!
            : Activity.Current?.TraceId.ToString() ?? Guid.NewGuid().ToString("N");

        context.Items[ItemsKey] = correlationId;
        context.Response.Headers[HeaderName] = correlationId;

        await _next(context);
    }

    /// <summary>
    /// An inbound correlation id is only honoured when it actually looks like an id. The value
    /// becomes the TraceId on every log scope for the request, is echoed into the response header,
    /// and is forwarded to downstream services — so an unbounded or control-character-carrying
    /// value could forge log lines, pollute correlation dashboards, or inflate ingestion cost.
    /// A rejected value is quietly replaced with a fresh id rather than 400-ing the request: the
    /// caller's id is a diagnostic convenience, not a credential, so a malformed one shouldn't
    /// fail otherwise-valid work.
    /// </summary>
    internal static bool IsWellFormed(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > MaxLength)
            return false;

        foreach (var c in value)
        {
            var ok = char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' or ':';
            if (!ok) return false;
        }

        return true;
    }
}
