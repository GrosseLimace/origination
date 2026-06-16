using GrainOriginatorPortal.Api.Middleware;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class RequestContextService : IRequestContextService
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public RequestContextService(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    /// <inheritdoc />
    public string GetCurrentUser()
    {
        var user = _httpContextAccessor.HttpContext?.User;
        return user?.FindFirst("preferred_username")?.Value
            ?? user?.FindFirst(System.Security.Claims.ClaimTypes.Upn)?.Value
            ?? user?.FindFirst("oid")?.Value
            ?? user?.Identity?.Name
            ?? "System";
    }

    /// <inheritdoc />
    public string GetCurrentUserShortName()
    {
        var user = _httpContextAccessor.HttpContext?.User;
        var upn = user?.FindFirst("preferred_username")?.Value
            ?? user?.FindFirst("upn")?.Value
            ?? user?.FindFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn")?.Value
            ?? user?.Identity?.Name
            ?? string.Empty;
        return upn.Contains('@') ? upn.Split('@')[0] : upn;
    }

    /// <inheritdoc />
    public string GetTraceId() =>
        _httpContextAccessor.HttpContext?.Items[CorrelationIdMiddleware.ItemsKey]?.ToString()
        ?? _httpContextAccessor.HttpContext?.TraceIdentifier
        ?? "no-trace";
}
