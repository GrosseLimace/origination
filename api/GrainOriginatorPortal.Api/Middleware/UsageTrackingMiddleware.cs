using System.Diagnostics;
using System.Threading.Channels;

namespace GrainOriginatorPortal.Api.Middleware;

/// <summary>
/// Records every authenticated API request into a bounded channel for async persistence.
/// Must run AFTER RequestContextMiddleware so the user identity is resolved.
/// Non-blocking: if the channel is full, the record is silently dropped.
/// </summary>
public class UsageTrackingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ChannelWriter<UserActivityRecord> _channelWriter;

    public UsageTrackingMiddleware(RequestDelegate next, Channel<UserActivityRecord> channel)
    {
        _next = next;
        _channelWriter = channel.Writer;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? string.Empty;

        // Skip non-API paths (health checks, static files, OpenAPI)
        if (!path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        var stopwatch = Stopwatch.StartNew();
        await _next(context);
        stopwatch.Stop();

        var rawUserId = context.User.FindFirst("preferred_username")?.Value
            ?? context.User.FindFirst("oid")?.Value
            ?? context.User.Identity?.Name;

        // Only track authenticated requests
        if (string.IsNullOrEmpty(rawUserId))
            return;

        // Normalize: strip @domain to match Entitlements view (e.g. "CEgr@scoular.com" → "CEgr")
        var userId = rawUserId.Contains('@') ? rawUserId.Split('@')[0] : rawUserId;

        var record = new UserActivityRecord
        {
            UserId = userId,
            HttpMethod = context.Request.Method,
            Path = path.Length > 500 ? path[..500] : path,
            StatusCode = context.Response.StatusCode,
            DurationMs = (int)stopwatch.ElapsedMilliseconds,
            Timestamp = DateTime.UtcNow
        };

        // Fire-and-forget: TryWrite is synchronous and non-blocking.
        // If the channel is full (DB is slow), the record is silently dropped.
        _channelWriter.TryWrite(record);
    }
}

/// <summary>
/// In-memory record passed through the channel from middleware to background service.
/// </summary>
public class UserActivityRecord
{
    public string UserId { get; set; } = string.Empty;
    public string HttpMethod { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
    public int StatusCode { get; set; }
    public int DurationMs { get; set; }
    public DateTime Timestamp { get; set; }
}

/// <summary>
/// In-memory record for frontend click events (calls, emails, feature navigation).
/// </summary>
public class UserClickEventRecord
{
    public string UserId { get; set; } = string.Empty;
    public string EventType { get; set; } = string.Empty;
    public string FeatureCode { get; set; } = string.Empty;
    public string? SubFeatureCode { get; set; }
    public string? TargetId { get; set; }
    public DateTime Timestamp { get; set; }
}
