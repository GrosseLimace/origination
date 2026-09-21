// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;

namespace GrainOriginatorPortal.Api.Middleware;

/// <summary>
/// Logs authorization denials at the point the framework decides them, per security-guide.md §8.1.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="SecurityAuditMiddleware"/> inspects <c>Response.StatusCode</c> after calling the rest
/// of the pipeline, which only works when the pipeline actually returns. It doesn't for the common
/// case: on a failed <c>[Authorize]</c> check, ASP.NET Core's authorization middleware calls
/// Challenge/Forbid and short-circuits <em>without</em> invoking the next delegate — so every
/// ordinary 401 and 403 skipped the audit log entirely.
/// </para>
/// <para>
/// Replacing the default <see cref="IAuthorizationMiddlewareResultHandler"/> is the framework's
/// supported hook for this: it runs on the authorization decision itself, before the short-circuit,
/// and then delegates to the default implementation so the response is written exactly as before.
/// Logging only — it never changes an allow/deny outcome.
/// </para>
/// </remarks>
public class AuthorizationAuditResultHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler _default = new();
    private readonly ILogger<AuthorizationAuditResultHandler> _logger;

    public AuthorizationAuditResultHandler(ILogger<AuthorizationAuditResultHandler> logger)
        => _logger = logger;

    // -------------------------------------------------------------------------
    public async Task HandleAsync(
        RequestDelegate next,
        HttpContext context,
        AuthorizationPolicy policy,
        PolicyAuthorizationResult authorizeResult)
    {
        if (!authorizeResult.Succeeded)
        {
            var traceId = context.Items[CorrelationIdMiddleware.ItemsKey]?.ToString()
                ?? context.TraceIdentifier;
            var method = context.Request.Method;
            var path = context.Request.Path.Value;

            if (authorizeResult.Challenged)
            {
                // No credentials, or credentials the scheme rejected → the caller gets a 401.
                _logger.LogWarning(
                    "Authentication required [{TraceId}] [{ErrorCode}] [{ErrorCategory}]: {Method} {Path} → 401",
                    traceId, "AUTH_REQUIRED", "Security", method, path);
            }
            else if (authorizeResult.Forbidden)
            {
                // Authenticated, but the policy said no → the caller gets a 403.
                var userId = context.User.Identity?.Name ?? "anonymous";

                _logger.LogWarning(
                    "Access denied [{TraceId}] [{ErrorCode}] [{ErrorCategory}]: {UserId} attempted {Method} {Path} → 403",
                    traceId, "ACCESS_DENIED", "Security", userId, method, path);
            }
        }

        await _default.HandleAsync(next, context, policy, authorizeResult);
    }
}
