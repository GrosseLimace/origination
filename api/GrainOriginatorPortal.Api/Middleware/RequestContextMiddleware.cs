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

        // Resolve the authenticated user from JWT claims.
        // preferred_username = UPN (user@scoular.com) — most readable for audit logs.
        // oid = Azure AD object ID — fallback for service principals without a UPN.
        // Requires this middleware to run AFTER UseAuthentication() so context.User is set.
        var userId = context.User.FindFirst("preferred_username")?.Value
            ?? context.User.FindFirst("oid")?.Value
            ?? context.User.Identity?.Name
            ?? "anonymous";

        // BeginScope on a shared-factory logger propagates to all loggers within
        // the same request (ASP.NET Core's scope provider is AsyncLocal-backed).
        // Method and path are request-supplied and the path is already URL-decoded, so both go through
        // LogSanitizer before they become a scope value every log record in the request will carry.
        // TraceId does not: CorrelationIdMiddleware only accepts an allow-listed id, otherwise it mints one.
        using (_logger.BeginScope(new Dictionary<string, object?>
        {
            ["ServiceName"] = "GrainOriginatorPortal.Api",
            ["Operation"]   = LogSanitizer.Clean($"{context.Request.Method} {context.Request.Path}"),
            ["TraceId"]     = traceId,
            ["UserId"]      = LogSanitizer.Clean(userId)
        }))
        {
            await _next(context);
        }
    }
}
