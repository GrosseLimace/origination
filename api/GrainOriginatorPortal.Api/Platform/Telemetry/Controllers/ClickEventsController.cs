// System namespaces
using System.Threading.Channels;

// Project namespaces
using GrainOriginatorPortal.Api.Platform.Middleware;
using GrainOriginatorPortal.Api.Platform.Telemetry;
using GrainOriginatorPortal.Api.Platform.Telemetry.Models.Requests;

namespace GrainOriginatorPortal.Api.Platform.Telemetry.Controllers;

/// <summary>
/// Records what people click in the UI, for usage tracking. Every signed-in user posts here, so it needs only a
/// sign-in. Reading the results is the usage dashboard's job, in the Usage Analytics module. The route stays under
/// <c>api/usage-dashboard</c>, where it began, so the client doesn't change.
/// </summary>
[ApiController]
[Route("api/usage-dashboard")]
[Authorize]
[Produces("application/json")]
public class ClickEventsController : ControllerBase
{
    // Writes to a bounded channel (no DbContext) drained by the usage-tracking background service.
    [HttpPost("click-event")]
    public ActionResult TrackClickEvent(
        [FromBody] ClickEventRequest request,
        [FromServices] Channel<UserClickEventRecord> clickChannel)
    {
        var userId = GetCurrentUserShortName();
        if (string.IsNullOrEmpty(userId))
            return Unauthorized();

        clickChannel.Writer.TryWrite(new UserClickEventRecord
        {
            UserId = userId,
            EventType = request.EventType,
            FeatureCode = request.FeatureCode,
            SubFeatureCode = request.SubFeatureCode,
            // Redact contact PII (emails / phone numbers) from free-text TargetIds before this
            // crosses into long-lived telemetry storage and the admin usage dashboard. See M-028.
            TargetId = ClampTargetId(TelemetrySanitizer.Redact(request.TargetId, request.SubFeatureCode)),
            Timestamp = DateTime.UtcNow
        });

        return Accepted();
    }

    /// <summary>
    /// Keeps a TargetId within its 200-character column. Applied after redaction, because the
    /// redaction markers can lengthen free text, and one over-length row fails the whole background
    /// batch insert — dropping every other user's events in it.
    /// </summary>
    internal static string? ClampTargetId(string? targetId) =>
        targetId is { Length: > 200 } ? targetId[..200] : targetId;

    /// <summary>The signed-in user's short name (UPN before the '@'), matching how activity rows
    /// and the entitlements view key users. Null when no identity is present.</summary>
    private string? GetCurrentUserShortName()
    {
        var raw = User.FindFirst("preferred_username")?.Value
            ?? User.FindFirst("oid")?.Value
            ?? User.Identity?.Name;

        if (string.IsNullOrEmpty(raw)) return null;
        return raw.Contains('@') ? raw.Split('@')[0] : raw;
    }
}
