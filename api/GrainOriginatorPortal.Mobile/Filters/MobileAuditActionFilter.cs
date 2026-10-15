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
/// the controller placed in <see cref="IAuditScope"/>. Applied to every mobile controller through
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
            "User={User} Oid={Oid} Client={ClientAppId} TraceId={TraceId} Entity={EntityType}/{EntityId} " +
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
            _audit.EntityType ?? "-",
            _audit.EntityId ?? "-",
            _audit.BeforeJson ?? "-",
            _audit.AfterJson ?? "-");
    }

    internal static string? AuditCodeFor(string method)
    {
        if (HttpMethods.IsPost(method)) return "AUDIT_CREATE";
        if (HttpMethods.IsPut(method) || HttpMethods.IsPatch(method)) return "AUDIT_UPDATE";
        if (HttpMethods.IsDelete(method)) return "AUDIT_DELETE";
        return null;
    }
}
