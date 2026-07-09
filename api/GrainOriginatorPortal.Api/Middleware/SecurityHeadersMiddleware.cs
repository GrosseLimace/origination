namespace GrainOriginatorPortal.Api.Middleware;

/// <summary>
/// Appends HTTP security response headers on every response per security-guide.md §4.1.
/// These headers harden the API against clickjacking, MIME-sniffing, and information leakage.
/// </summary>
public class SecurityHeadersMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IWebHostEnvironment _env;
    private readonly string[] _spaConnectHosts;

    public SecurityHeadersMiddleware(RequestDelegate next, IWebHostEnvironment env, IConfiguration config)
    {
        _next = next;
        _env = env;
        // Per-environment API/App Service hosts the SPA may call, e.g.
        // "https://app-origination-eus.azurewebsites.net". Configured in appsettings.{Env}.json so
        // each environment allows only its own host — replaces the old *.azurewebsites.net wildcard.
        _spaConnectHosts = config.GetSection("SecurityHeaders:SpaConnectSrcHosts").Get<string[]>()
            ?? Array.Empty<string>();
    }

    public async Task InvokeAsync(HttpContext context)
    {
        context.Response.OnStarting(() =>
        {
            var headers = context.Response.Headers;

            // Prevent MIME type sniffing
            headers["X-Content-Type-Options"] = "nosniff";

            // Deny framing
            headers["X-Frame-Options"] = "DENY";

            // Block cross-domain Flash/PDF policies
            headers["X-Permitted-Cross-Domain-Policies"] = "none";

            // Limit referrer information on cross-origin requests
            headers["Referrer-Policy"] = "strict-origin-when-cross-origin";

            // Force HTTPS for 1 year
            headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";

            // CSP: restrictive for API responses, permissive for SPA
            headers["Content-Security-Policy"] = context.Request.Path.StartsWithSegments("/api")
                ? "default-src 'none'"
                : BuildSpaContentSecurityPolicy(_env.IsDevelopment(), _spaConnectHosts);

            return Task.CompletedTask;
        });

        await _next(context);
    }

    /// <summary>Builds the SPA Content-Security-Policy. <c>img-src</c> allows the map tile hosts
    /// (OpenStreetMap street tiles + Esri aerial imagery for the bid-sheet satellite view).
    /// localhost origins are only added when <paramref name="isDevelopment"/> is true — including them
    /// in deployed environments would let injected script reach the victim's local services /
    /// exfiltrate to a local listener (CWE-942).
    /// <para><paramref name="connectHosts"/> are the specific per-environment API/App Service hosts
    /// allowed in <c>connect-src</c> (from config). This replaces the former
    /// <c>https://*.azurewebsites.net</c> wildcard, which let injected script exfiltrate to ANY
    /// Azure-hosted site (CWE-942 / M-025). Each environment supplies only its own host.</para></summary>
    public static string BuildSpaContentSecurityPolicy(bool isDevelopment, IEnumerable<string>? connectHosts = null)
    {
        var devConnectSrc = isDevelopment ? " http://localhost:5000 https://localhost:*" : string.Empty;
        var configuredHosts = connectHosts is null
            ? string.Empty
            : string.Concat(connectHosts
                .Where(h => !string.IsNullOrWhiteSpace(h))
                .Select(h => " " + h.Trim()));
        return
            "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
            "font-src 'self' https://fonts.gstatic.com data:; " +
            "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://server.arcgisonline.com; " +
            "connect-src 'self' https://login.microsoftonline.com https://graph.microsoft.com" + configuredHosts + devConnectSrc + "; " +
            "frame-src 'self' https://login.microsoftonline.com; " +
            "object-src 'none'; " +
            "base-uri 'self';";
    }
}
