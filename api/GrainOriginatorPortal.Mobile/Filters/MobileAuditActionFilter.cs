using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Mobile.Auditing;
using GrainOriginatorPortal.Mobile.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Mobile.Filters;

/// <summary>
/// Writes one structured audit line for every mobile mutation (POST/PUT/PATCH/DELETE), whether it
/// succeeded or threw: verb-derived <c>AUDIT_CREATE|UPDATE|DELETE</c> code, caller (short name and
/// Entra object id), client app id, correlation id, route, entity, and the redacted before/after state
/// the controller placed in <see cref="IAuditScope"/>, and the source IP (STD-MAA-001 MAA-6.1): the direct peer plus
/// the X-Forwarded-For chain (behind App Gateway + APIM the peer is the gateway, the caller is in the chain). Applied to every mobile controller through
/// <c>[ServiceFilter]</c> on <see cref="Controllers.MobileControllerBase"/>. Reads are not audited here;
/// they are covered by the request/usage logging the host already does.
/// </summary>
public sealed class MobileAuditActionFilter : IAsyncActionFilter
{
    private readonly IRequestContextService _requestContext;
    private readonly IAuditScope _audit;
    private readonly ILogger<MobileAuditActionFilter> _logger;

    public MobileAuditActionFilter(
        IRequestContextService requestContext,
        IAuditScope audit,
        ILogger<MobileAuditActionFilter> logger)
    {
        _requestContext = requestContext;
        _audit = audit;
        _logger = logger;
    }

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var method = context.HttpContext.Request.Method;
        var auditCode = AuditCodeFor(method);

        var executed = await next();

        if (auditCode is null)
        {
            return;
        }

        var user = context.HttpContext.User;
        var failed = executed.Exception is not null && !executed.ExceptionHandled;
        var status = failed
            ? 0
            : (executed.Result as IStatusCodeActionResult)?.StatusCode ?? StatusCodes.Status200OK;

        var routeValues = string.Join(",",
            context.ActionDescriptor.RouteValues
                .Where(kvp => kvp.Key is not "controller" and not "action")
                .Concat(context.HttpContext.Request.RouteValues
                    .Where(kvp => kvp.Key is not "controller" and not "action")
                    .Select(kvp => new KeyValuePair<string, string?>(kvp.Key, kvp.Value?.ToString())))
                .Select(kvp => $"{kvp.Key}={kvp.Value}"));

        var template = context.ActionDescriptor.AttributeRouteInfo?.Template ?? context.HttpContext.Request.Path.ToString();

        _logger.Log(
            failed ? LogLevel.Warning : LogLevel.Information,
            "Mobile mutation [{ErrorCode}] [{ErrorCategory}]: {Method} {Route} ({RouteValues}) Status={Status} " +
            "User={User} Oid={Oid} Client={ClientAppId} TraceId={TraceId} Ip={RemoteIp} ForwardedFor={ForwardedFor} " +
            "Entity={EntityType}/{EntityId} " +
            "Before={Before} After={After}",
            failed ? auditCode + "_FAILED" : auditCode,
            "DataMutation",
            method,
            template,
            routeValues,
            status,
            _requestContext.GetCurrentUserShortName(),
            MobileAccess.GetObjectId(user) ?? "-",
            MobileAccess.GetClientAppId(user) ?? "-",
            _requestContext.GetTraceId(),
            context.HttpContext.Connection.RemoteIpAddress?.ToString() ?? "-",
            ForwardedFor(context.HttpContext.Request),
            _audit.EntityType ?? "-",
            _audit.EntityId ?? "-",
            _audit.BeforeJson ?? "-",
            _audit.AfterJson ?? "-");
    }

    /// <summary>
    /// The X-Forwarded-For chain for the audit line. The header is partly client-supplied, so it is reduced to
    /// IP-address characters (hex digits, dots, colons, commas, spaces) and capped, so it can never inject text into the log.
    /// </summary>
    internal static string ForwardedFor(HttpRequest request)
    {
        var raw = request.Headers["X-Forwarded-For"].ToString();
        if (string.IsNullOrWhiteSpace(raw)) return "-";
        var cleaned = new string(raw.Where(c => Uri.IsHexDigit(c) || c is '.' or ':' or ',' or ' ').Take(200).ToArray()).Trim();
        return cleaned.Length == 0 ? "-" : cleaned;
    }

    internal static string? AuditCodeFor(string method)
    {
        if (HttpMethods.IsPost(method)) return "AUDIT_CREATE";
        if (HttpMethods.IsPut(method) || HttpMethods.IsPatch(method)) return "AUDIT_UPDATE";
        if (HttpMethods.IsDelete(method)) return "AUDIT_DELETE";
        return null;
    }
}
