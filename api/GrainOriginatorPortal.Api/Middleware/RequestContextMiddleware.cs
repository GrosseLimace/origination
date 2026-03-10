namespace GrainOriginatorPortal.Api.Middleware;

/// <summary>
/// Sets per-request structured log properties as an ambient ILogger scope so that
/// every log entry within the request automatically includes the required fields
/// per error-handling-standards.md §4.1: ServiceName, Operation, TraceId, UserId.
/// Must be registered AFTER CorrelationIdMiddleware so the traceId is already resolved.
/// </summary>
public class RequestContextMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<RequestContextMiddleware> _logger;

    public RequestContextMiddleware(RequestDelegate next, ILogger<RequestContextMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    public async Task InvokeAsync(HttpContext context)
    {
        var traceId = context.Items[CorrelationIdMiddleware.ItemsKey]?.ToString()
            ?? context.TraceIdentifier;

        // BeginScope on a shared-factory logger propagates to all loggers within
        // the same request (ASP.NET Core's scope provider is AsyncLocal-backed).
        using (_logger.BeginScope(new Dictionary<string, object?>
        {
            ["ServiceName"] = "GrainOriginatorPortal.Api",
            ["Operation"]   = $"{context.Request.Method} {context.Request.Path}",
            ["TraceId"]     = traceId,
            ["UserId"]      = "anonymous"   // updated once MSAL auth is wired
        }))
        {
            await _next(context);
        }
    }
}
