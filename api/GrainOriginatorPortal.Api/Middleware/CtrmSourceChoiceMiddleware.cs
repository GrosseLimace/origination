using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Middleware;

/// <summary>
/// Captures the caller's identity and their <c>X-Data-Source-Preference</c> header into the request's
/// <see cref="CtrmSourceChoice"/>, so the contract and ticket switches can honour an allow-listed tester's
/// choice between ODS and CTRM.
/// </summary>
/// <remarks>
/// Must run after <c>UseAuthentication</c>, since the identity comes from the validated token. It records
/// and does not decide: the allow-list check happens in <see cref="CtrmSourceChoice"/> at read time, against
/// configuration that is re-read per call, so adding or removing a tester is an App Service setting change
/// with no restart of this middleware's state. The header value is stored trimmed and otherwise raw; only
/// the two known values ever take effect.
/// </remarks>
public sealed class CtrmSourceChoiceMiddleware
{
    private readonly RequestDelegate _next;

    public CtrmSourceChoiceMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context, CtrmSourceChoice choice)
    {
        var user = context.User;
        // Same claim order RequestContextService uses, so the id matched against the allow-list is the
        // same one that appears in the logs and in GET /api/me.
        var userId = user?.FindFirst("preferred_username")?.Value
            ?? user?.FindFirst(System.Security.Claims.ClaimTypes.Upn)?.Value
            ?? user?.FindFirst("upn")?.Value
            ?? user?.FindFirst("oid")?.Value
            ?? user?.Identity?.Name;

        var requested = context.Request.Headers.TryGetValue(CtrmSourceChoice.PreferenceHeader, out var values)
            ? values.ToString()
            : null;

        choice.Set(userId, LogSanitizer.Clean(requested, 16));

        await _next(context);
    }
}
