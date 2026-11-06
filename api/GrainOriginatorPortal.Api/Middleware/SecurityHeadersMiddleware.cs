using GrainOriginatorPortal.Api.Services;

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
    private readonly string[] _spaCallingConnectHosts;
    private readonly string? _spaCallingMediaSrc;
    private readonly string? _spaCallingWorkerSrc;

    public SecurityHeadersMiddleware(RequestDelegate next, IWebHostEnvironment env, IConfiguration config)
    {
        _next = next;
        _env = env;
        _spaConnectHosts = SpaConnectHosts(config);

        // The ACS Calling SDK (incoming-call popup) talks to Microsoft's signalling and media hosts
        // straight from the browser. Those origins are only admitted when the feature is actually
        // on in this environment (Acs:Endpoint configured); otherwise the policy is exactly what it
        // was before the feature existed. Deliberately config-driven so a newly discovered host can
        // be allowed with a config change rather than a code deploy.
        var callingEnabled = !string.IsNullOrWhiteSpace(config["Acs:Endpoint"]);
        _spaCallingConnectHosts = callingEnabled
            ? config.GetSection("SecurityHeaders:SpaCallingConnectSrcHosts").Get<string[]>() ?? Array.Empty<string>()
            : Array.Empty<string>();
        _spaCallingMediaSrc = callingEnabled ? config["SecurityHeaders:SpaCallingMediaSrc"] : null;
        _spaCallingWorkerSrc = callingEnabled ? config["SecurityHeaders:SpaCallingWorkerSrc"] : null;
    }

    /// <summary>The hosts the SPA may reach beyond 'self' and Microsoft login/graph:
    /// <list type="bullet">
    /// <item>this environment's own API/App Service host, e.g. <c>https://app-origination-eus.azurewebsites.net</c>,
    /// from <c>SecurityHeaders:SpaConnectSrcHosts</c> in appsettings.{Env}.json, which replaces the old
    /// <c>*.azurewebsites.net</c> wildcard;</item>
    /// <item>its App Insights ingestion host, and only that one, when the browser app is sending
    /// telemetry. See <see cref="ClientTelemetrySettings"/> for why it is not a wildcard.</item>
    /// </list></summary>
    public static string[] SpaConnectHosts(IConfiguration config)
    {
        var configured = config.GetSection("SecurityHeaders:SpaConnectSrcHosts").Get<string[]>() ?? [];
        var ingestion = ClientTelemetrySettings.From(config).IngestionOrigin;
        return ingestion is null ? configured : [.. configured, ingestion];
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

            // CSP: restrictive for API responses, permissive for SPA. frame-ancestors is spelled out on
            // both because it has NO fallback to default-src (CSP3 §6.4): without it a policy that says
            // default-src 'none' still lets the response be framed, and modern browsers prefer this
            // directive over the legacy X-Frame-Options header above (QA scan 2026-09-30).
            headers["Content-Security-Policy"] = context.Request.Path.StartsWithSegments("/api")
                ? "default-src 'none'; frame-ancestors 'none'"
                : BuildSpaContentSecurityPolicy(_env.IsDevelopment(), _spaConnectHosts,
                    _spaCallingConnectHosts, _spaCallingMediaSrc, _spaCallingWorkerSrc);

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
    /// Azure-hosted site (CWE-942 / M-025). Each environment supplies only its own host.</para>
    /// <para><c>frame-ancestors 'none'</c> and <c>form-action 'self'</c> (added 2026-09-30) have no fallback
    /// to <c>default-src</c>, so leaving them out is the same as allowing anything. The app renders no
    /// HTML forms that post anywhere and is never legitimately framed; MSAL signs in by redirect with the
    /// response in the URL fragment, not by a form post, so neither directive touches the login flow.</para>
    /// <para><c>style-src 'unsafe-inline'</c> STAYS, knowingly. Angular injects every component's styles as
    /// inline <c>&lt;style&gt;</c> elements at runtime; removing the keyword needs Angular's CSP nonce
    /// (<c>ngCspNonce</c>) plumbed from a per-request server value into the served <c>index.html</c>, which
    /// is a change to how the SPA is hosted, not a header tweak. Scripts are already <c>'self'</c> only, which
    /// is the half of CSP that stops script injection; inline styles alone cannot run code.</para>
    /// <para><paramref name="callingConnectHosts"/>, <paramref name="callingMediaSrc"/> and
    /// <paramref name="callingWorkerSrc"/> are the ACS Calling SDK's origins (incoming-call popup). The
    /// middleware passes them only when <c>Acs:Endpoint</c> is configured, so an environment without the
    /// feature gets the unchanged policy; <c>media-src</c> / <c>worker-src</c> are emitted only when a
    /// value is supplied, otherwise they keep falling back to <c>default-src 'self'</c>.</para></summary>
    public static string BuildSpaContentSecurityPolicy(
        bool isDevelopment,
        IEnumerable<string>? connectHosts = null,
        IEnumerable<string>? callingConnectHosts = null,
        string? callingMediaSrc = null,
        string? callingWorkerSrc = null)
    {
        var devConnectSrc = isDevelopment ? " http://localhost:5000 https://localhost:*" : string.Empty;
        var configuredHosts = JoinHosts(connectHosts) + JoinHosts(callingConnectHosts);
        var mediaSrc = string.IsNullOrWhiteSpace(callingMediaSrc)
            ? string.Empty
            : "media-src 'self' " + callingMediaSrc.Trim() + "; ";
        var workerSrc = string.IsNullOrWhiteSpace(callingWorkerSrc)
            ? string.Empty
            : "worker-src 'self' " + callingWorkerSrc.Trim() + "; ";
        return
            "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
            "font-src 'self' https://fonts.gstatic.com data:; " +
            "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://server.arcgisonline.com; " +
            mediaSrc +
            workerSrc +
            "connect-src 'self' https://login.microsoftonline.com https://graph.microsoft.com" + configuredHosts + devConnectSrc + "; " +
            // blob: (2026-11-05): the 45Z documents dialog shows a PDF or image in an iframe from a blob: URL the
            // app made itself from an allow-listed type. Only the app's own script ('self') can make one.
            "frame-src 'self' blob: https://login.microsoftonline.com; " +
            "frame-ancestors 'none'; " +
            "form-action 'self'; " +
            "object-src 'none'; " +
            "base-uri 'self';";
    }

    private static string JoinHosts(IEnumerable<string>? hosts) =>
        hosts is null
            ? string.Empty
            : string.Concat(hosts
                .Where(h => !string.IsNullOrWhiteSpace(h))
                .Select(h => " " + h.Trim()));
}
