namespace GrainOriginatorPortal.Api.Middleware;

/// <summary>
/// Logs security audit events for authentication (401) and authorization (403) failures
/// per security-guide.md §8.1: "Log auth events, access denials, and suspicious patterns."
/// Runs after UseAuthentication/UseAuthorization so the response status code is final.
/// </summary>
public class SecurityAuditMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<SecurityAuditMiddleware> _logger;

    public SecurityAuditMiddleware(RequestDelegate next, ILogger<SecurityAuditMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        await _next(context);

        var traceId = context.Items[CorrelationIdMiddleware.ItemsKey]?.ToString()
            ?? context.TraceIdentifier;

        var method = context.Request.Method;
        var path   = context.Request.Path.Value;

        switch (context.Response.StatusCode)
        {
            case StatusCodes.Status401Unauthorized:
                // Auth failure — no valid bearer token presented or token validation failed.
                // JWT-level failures are logged in OnAuthenticationFailed; this catches any
                // 401 that wasn't already logged (e.g. missing Authorization header).
                _logger.LogWarning(
                    "Authentication required [{TraceId}] [{ErrorCode}] [{ErrorCategory}]: {Method} {Path} → 401",
                    traceId, "AUTH_REQUIRED", "Security", method, path);
                break;

            case StatusCodes.Status403Forbidden:
                // Access denied — token was valid but the caller lacks required permission.
                var userId = context.User.Identity?.Name ?? "anonymous";
                _logger.LogWarning(
                    "Access denied [{TraceId}] [{ErrorCode}] [{ErrorCategory}]: {UserId} attempted {Method} {Path} → 403",
                    traceId, "ACCESS_DENIED", "Security", userId, method, path);
                break;
        }
    }
}
