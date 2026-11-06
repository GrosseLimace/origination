// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;

// Project namespaces
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Platform.Access;

namespace GrainOriginatorPortal.Api.Middleware;

/// <summary>
/// Logs authorization denials at the point the framework decides them, and gives each one the standard
/// error envelope.
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
/// and then delegates to the default implementation, which sets the 401/403 and its headers.
/// It never changes an allow/deny outcome.
/// </para>
/// <para>
/// The default implementation sends an empty body, so a 401/403 was the one API error without the
/// standard <see cref="ApiErrorResponse"/> envelope (error-handling.md §2, audit 2026-11-05). After
/// delegating, this writes that envelope with the same trace id the log line carries, unless
/// something has already started the response.
/// </para>
/// <para>
/// <b>Permission denials</b> (a <c>[RequirePermission]</c> the caller doesn't meet) get
/// <c>AUTHZ_PERMISSION_DENIED</c> with each missing permission in <c>details</c>. It names only the
/// permissions the endpoint needs, never the ones the caller holds; <c>/api/me/permissions</c> is for
/// that. Every other refusal gets <c>AUTH_REQUIRED</c> (401) or <c>ACCESS_DENIED</c> (403).
/// </para>
/// </remarks>
public class AuthorizationAuditResultHandler : IAuthorizationMiddlewareResultHandler
{
    /// <summary>The error code for a missing permission, in the 403 body and the log line.</summary>
    public const string PermissionDeniedCode = "AUTHZ_PERMISSION_DENIED";

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
        var traceId = context.Items[CorrelationIdMiddleware.ItemsKey]?.ToString()
            ?? context.TraceIdentifier;
        var method = context.Request.Method;
        var path = context.Request.Path.Value;
        string[] missingPermissions = [];

        if (!authorizeResult.Succeeded)
        {
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
                missingPermissions = MissingPermissions(authorizeResult);

                if (missingPermissions.Length > 0)
                {
                    _logger.LogWarning(
                        "Permission denied [{TraceId}] [{ErrorCode}] [{ErrorCategory}]: {UserId} attempted {Method} {Path} without {RequiredPermissions} → 403",
                        traceId, PermissionDeniedCode, "Security", userId, method, path, missingPermissions);
                }
                else
                {
                    _logger.LogWarning(
                        "Access denied [{TraceId}] [{ErrorCode}] [{ErrorCategory}]: {UserId} attempted {Method} {Path} → 403",
                        traceId, "ACCESS_DENIED", "Security", userId, method, path);
                }
            }
        }

        await _default.HandleAsync(next, context, policy, authorizeResult);

        // The default handler sets the status with an empty body, so the body is still ours to write.
        if (authorizeResult.Succeeded || context.Response.HasStarted)
            return;

        if (missingPermissions.Length > 0)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(
                PermissionDenied(missingPermissions, traceId, path),
                context.RequestAborted);
        }
        else if (context.Response.StatusCode is StatusCodes.Status401Unauthorized or StatusCodes.Status403Forbidden)
        {
            await context.Response.WriteAsJsonAsync(
                Refused(context.Response.StatusCode == StatusCodes.Status401Unauthorized, traceId, path),
                context.RequestAborted);
        }
    }

    // -------------------------------------------------------------------------
    private static string[] MissingPermissions(PolicyAuthorizationResult authorizeResult) =>
        authorizeResult.AuthorizationFailure?.FailedRequirements
            .OfType<PermissionRequirement>()
            .Select(r => r.Permission)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray()
        ?? [];

    // -------------------------------------------------------------------------
    private static ApiErrorResponse PermissionDenied(string[] missingPermissions, string traceId, string? path) => new()
    {
        Error = new ApiErrorBody
        {
            Code = PermissionDeniedCode,
            Message = "Insufficient permissions.",
            Details = missingPermissions
                .Select(p => new ApiErrorDetail { Field = "permission", Message = $"Requires '{p}'.", Code = p })
                .ToList(),
            TraceId = traceId,
            Timestamp = DateTime.UtcNow.ToString("O"),
            Instance = path,
        },
    };

    // -------------------------------------------------------------------------
    private static ApiErrorResponse Refused(bool unauthenticated, string traceId, string? path) => new()
    {
        Error = new ApiErrorBody
        {
            Code = unauthenticated ? "AUTH_REQUIRED" : "ACCESS_DENIED",
            // The 403 text is the client's own fallback wording, so users see exactly what they did before.
            Message = unauthenticated
                ? "Authentication required. Please sign in again."
                : "Access denied: you are not authorized for this resource.",
            TraceId = traceId,
            Timestamp = DateTime.UtcNow.ToString("O"),
            Instance = path,
        },
    };
}
