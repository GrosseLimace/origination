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

    private readonly RequestDelegate _next;

    public CorrelationIdMiddleware(RequestDelegate next) => _next = next;

    // -------------------------------------------------------------------------
    public async Task InvokeAsync(HttpContext context)
    {
        var correlationId = context.Request.Headers[HeaderName].FirstOrDefault()
            ?? Activity.Current?.TraceId.ToString()
            ?? Guid.NewGuid().ToString("N");

        context.Items[ItemsKey] = correlationId;
        context.Response.Headers[HeaderName] = correlationId;

        await _next(context);
    }
}
