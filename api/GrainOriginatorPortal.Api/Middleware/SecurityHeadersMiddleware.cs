namespace GrainOriginatorPortal.Api.Middleware;

/// <summary>
/// Appends HTTP security response headers on every response per security-guide.md §4.1.
/// These headers harden the API against clickjacking, MIME-sniffing, and information leakage.
/// </summary>
public class SecurityHeadersMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IWebHostEnvironment _env;

    public SecurityHeadersMiddleware(RequestDelegate next, IWebHostEnvironment env)
    {
        _next = next;
        _env = env;
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
            if (context.Request.Path.StartsWithSegments("/api"))
            {
                headers["Content-Security-Policy"] = "default-src 'none'";
            }
            else
            {
                // localhost origins are only needed for local dev (SPA → API on localhost). Including
                // them in deployed environments would let injected script reach the victim's local
                // services / exfiltrate to a local listener (CWE-942), so gate them behind IsDevelopment().
                var devConnectSrc = _env.IsDevelopment() ? " http://localhost:5000 https://localhost:*" : string.Empty;
                headers["Content-Security-Policy"] =
                    "default-src 'self'; " +
                    "script-src 'self'; " +
                    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
                    "font-src 'self' https://fonts.gstatic.com data:; " +
                    "img-src 'self' data: blob: https://*.tile.openstreetmap.org; " +
                    "connect-src 'self' https://login.microsoftonline.com https://*.azurewebsites.net https://graph.microsoft.com" + devConnectSrc + "; " +
                    "frame-src 'self' https://login.microsoftonline.com; " +
                    "object-src 'none'; " +
                    "base-uri 'self';";
            }

            return Task.CompletedTask;
        });

        await _next(context);
    }
}
