using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Middleware;

/// <summary>
/// Captures the caller's identity, their <c>X-Data-Source-Preference</c> header, and whether they are on
/// the tester list into the request's <see cref="CtrmSourceChoice"/>, so the contract and ticket switches
/// can honour an allow-listed tester's choice between ODS and CTRM.
/// </summary>
/// <remarks>
/// Must run after <c>UseAuthentication</c>, since the identity comes from the validated token. The list is
/// two halves: the <c>dbo.CtrmSourceToggleUsers</c> table (through a provider cached for a minute) and the
/// <c>Ctrm:SourceToggleUsers</c> setting (read per request). Either grants. The header value is stored
/// trimmed and otherwise raw; only the two known values ever take effect. Anonymous requests are never
/// allow-listed, whatever the table says.
/// </remarks>
public sealed class CtrmSourceChoiceMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IConfiguration _configuration;

    public CtrmSourceChoiceMiddleware(RequestDelegate next, IConfiguration configuration)
    {
        _next = next;
        _configuration = configuration;
    }

    public async Task InvokeAsync(HttpContext context, CtrmSourceChoice choice, ICtrmSourceToggleUserProvider testers)
    {
        var user = context.User;
        // Same claim order RequestContextService uses, so the id matched against the list is the same one
        // that appears in the logs and in GET /api/me.
        var userId = user?.FindFirst("preferred_username")?.Value
            ?? user?.FindFirst(System.Security.Claims.ClaimTypes.Upn)?.Value
            ?? user?.FindFirst("upn")?.Value
            ?? user?.FindFirst("oid")?.Value
            ?? user?.Identity?.Name;

        var requested = context.Request.Headers.TryGetValue(CtrmSourceChoice.PreferenceHeader, out var values)
            ? values.ToString()
            : null;

        // Only consult the table when someone is actually signed in; the anonymous 401s never need it.
        var allowListed = !string.IsNullOrWhiteSpace(userId)
            && CtrmSourceChoice.IsToggleUser(_configuration, userId, await testers.GetAsync(context.RequestAborted));

        choice.Set(userId, LogSanitizer.Clean(requested, 16), allowListed);

        await _next(context);
    }
}
