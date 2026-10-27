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
    /// <summary>The Entra optional claim IT added to the API's token (Dev 2026-10-27). Present only
    /// when the directory has a title for the person; reflects the title at sign-in.</summary>
    public const string JobTitleClaim = "jobTitle";

    /// <summary>Matches the dbo.UserJobTitle column; a longer value would fail the whole batch insert.</summary>
    private const int MaxJobTitleLength = 256;

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

        // Skip machine-to-machine ingestion. Those callers are application identities, not people —
        // tracking them would add a service principal's object id to the usage dashboard's user list.
        if (path.StartsWith("/api/barchart-ingest", StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        var stopwatch = Stopwatch.StartNew();

        // Record in a finally so a request that ends in an unhandled exception still counts. This
        // middleware sits inside UseExceptionHandler's scope, so without this the throwing requests
        // — exactly the ones the error-rate figures need — never reached the channel at all.
        try
        {
            await _next(context);
        }
        finally
        {
            stopwatch.Stop();
            TryRecord(context, path, stopwatch);
        }
    }

    // -------------------------------------------------------------------------
    private void TryRecord(HttpContext context, string path, Stopwatch stopwatch)
    {
        var rawUserId = context.User.FindFirst("preferred_username")?.Value
            ?? context.User.FindFirst("oid")?.Value
            ?? context.User.Identity?.Name;

        // Only track authenticated requests
        if (string.IsNullOrEmpty(rawUserId))
            return;

        // Normalize: strip @domain to match Entitlements view (e.g. "CEgr@scoular.com" → "CEgr")
        var userId = rawUserId.Contains('@') ? rawUserId.Split('@')[0] : rawUserId;

        // A missing claim is "no title in the directory", which the dashboard shows as "No title" —
        // never an error. The record carries it so the background writer can keep one latest-title
        // row per user; it is not stored on the activity row itself.
        var jobTitle = context.User.FindFirst(JobTitleClaim)?.Value?.Trim();
        if (string.IsNullOrEmpty(jobTitle)) jobTitle = null;
        else if (jobTitle.Length > MaxJobTitleLength) jobTitle = jobTitle[..MaxJobTitleLength];

        var record = new UserActivityRecord
        {
            UserId = userId,
            HttpMethod = context.Request.Method,
            Path = path.Length > 500 ? path[..500] : path,
            StatusCode = context.Response.StatusCode,
            DurationMs = (int)stopwatch.ElapsedMilliseconds,
            Timestamp = DateTime.UtcNow,
            JobTitle = jobTitle
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

    /// <summary>The token's <c>jobTitle</c> claim, or null when absent. Consumed by
    /// <c>JobTitleChangeTracker</c>, not persisted per activity row.</summary>
    public string? JobTitle { get; set; }
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
