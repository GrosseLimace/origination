namespace GrainOriginatorPortal.Api.Middleware;

/// <summary>
/// Appends HTTP security response headers on every response per security-guide.md §4.1.
/// These headers harden the API against clickjacking, MIME-sniffing, and information leakage.
/// </summary>
public class SecurityHeadersMiddleware
{
    private readonly RequestDelegate _next;

    public SecurityHeadersMiddleware(RequestDelegate next)
    {
        _next = next;
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
                headers["Content-Security-Policy"] =
                    "default-src 'self'; " +
                    "script-src 'self'; " +
                    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
                    "font-src 'self' https://fonts.gstatic.com data:; " +
                    "img-src 'self' data: https://*.tile.openstreetmap.org; " +
                    "connect-src 'self' https://login.microsoftonline.com https://*.azurewebsites.net http://localhost:5000 https://localhost:* https://graph.microsoft.com; " +
                    "frame-src 'self' https://login.microsoftonline.com; " +
                    "object-src 'none'; " +
                    "base-uri 'self';";
            }

            return Task.CompletedTask;
        });

        await _next(context);
    }
}
