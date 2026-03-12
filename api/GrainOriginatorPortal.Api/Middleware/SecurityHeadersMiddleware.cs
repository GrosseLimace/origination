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

            // Defense-in-depth CSP for API responses — block everything by default
            headers["Content-Security-Policy"] = "default-src 'none'";

            return Task.CompletedTask;
        });

        await _next(context);
    }
}
