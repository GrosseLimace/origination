using System.Threading.Channels;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/usage-dashboard")]
// Baseline: any authenticated user. Individual data-read endpoints require the
// `Admin` app role (applied as `[Authorize(Policy = "AdminOnly")]` per method)
// because ASP.NET combines Authorize attributes with AND — a class-level
// AdminOnly would also block the telemetry endpoint below, which needs to
// accept click events from every signed-in user for user-activity tracking.
[Authorize]
[Produces("application/json")]
public class UsageDashboardController : ControllerBase
{
    private readonly IUsageDashboardService _service;

    public UsageDashboardController(IUsageDashboardService service)
    {
        _service = service;
    }

    // `from`/`to` are calendar dates (yyyy-MM-dd) interpreted in UTC; the window is
    // [from 00:00Z, to+1day 00:00Z), so from == to is one full day. Binding DateOnly rather than
    // DateTime keeps the boundary from shifting with the server's local timezone.

    [HttpGet("summary")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<UsageDashboardSummaryDto>> GetSummary(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? tradeUnitKey = null, CancellationToken cancellationToken = default)
        => Ok(await _service.GetSummaryAsync(from, to, tradeUnitKey, cancellationToken));

    [HttpGet("users")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<UsageDashboardUserDto>>> GetUsers(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? tradeUnitKey = null, [FromQuery] string? status = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetUsersAsync(from, to, tradeUnitKey, status, cancellationToken));

    [HttpGet("daily-active")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<DailyActiveDto>>> GetDailyActive(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? tradeUnitKey = null, CancellationToken cancellationToken = default)
        => Ok(await _service.GetDailyActiveAsync(from, to, tradeUnitKey, cancellationToken));

    [HttpGet("feature-sessions")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<FeatureSessionsDto>>> GetFeatureSessions(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? tradeUnitKey = null, [FromQuery] string? screen = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetFeatureSessionsAsync(from, to, tradeUnitKey, screen, cancellationToken));

    // Trend view over whole calendar weeks — deliberately not bound to the dashboard's date filter.
    [HttpGet("weekly-trend")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<WeeklyTrendDto>>> GetWeeklyTrend(
        [FromQuery] string? tradeUnitKey = null, [FromQuery] int weeks = 8,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetWeeklyTrendAsync(tradeUnitKey, weeks, cancellationToken));

    [HttpGet("activity-breakdown")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<ActivityBreakdownDto>>> GetActivityBreakdown(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? tradeUnitKey = null, CancellationToken cancellationToken = default)
        => Ok(await _service.GetActivityBreakdownAsync(from, to, tradeUnitKey, cancellationToken));

    // "Days since last login" is measured as of now against all history, so this takes no window.
    [HttpGet("inactive")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<UsageDashboardInactiveUserDto>>> GetInactiveUsers(
        [FromQuery] string? tradeUnitKey = null, [FromQuery] int daysThreshold = 30,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetInactiveUsersAsync(tradeUnitKey, daysThreshold, cancellationToken));

    [HttpGet("underused-features")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<UnderusedFeatureDto>>> GetUnderusedFeatures(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? tradeUnitKey = null, CancellationToken cancellationToken = default)
        => Ok(await _service.GetUnderusedFeaturesAsync(from, to, tradeUnitKey, cancellationToken));

    [HttpGet("query-library-usage")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<QueryLibraryUsageDto>>> GetQueryLibraryUsage(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? tradeUnitKey = null, CancellationToken cancellationToken = default)
        => Ok(await _service.GetQueryLibraryUsageAsync(from, to, tradeUnitKey, cancellationToken));

    [HttpGet("query-search-gaps")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<QuerySearchGapDto>>> GetQuerySearchGaps(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? tradeUnitKey = null, CancellationToken cancellationToken = default)
        => Ok(await _service.GetQuerySearchGapsAsync(from, to, tradeUnitKey, cancellationToken));

    // Per-user drill-down. Aggregates one originator's full activity profile in the window.
    [HttpGet("users/{userId}/detail")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<UserUsageDetailDto>> GetUserDetail(
        string userId,
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? tradeUnitKey = null,
        CancellationToken cancellationToken = default)
    {
        var detail = await _service.GetUserDetailAsync(userId, from, to, tradeUnitKey, cancellationToken);
        if (detail is null) return NotFound();
        return Ok(detail);
    }

    // ── Excluded users ──
    // Accounts kept out of every dashboard view (IT/dev/admin accounts whose activity would skew
    // adoption). Excluding someone changes nothing about their access to the app.

    [HttpGet("excluded-users")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<ExcludedUserDto>>> GetExcludedUsers(CancellationToken cancellationToken = default)
        => Ok(await _service.GetExcludedUsersAsync(cancellationToken));

    [HttpPost("excluded-users")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<ExcludedUserDto>> AddExcludedUser(
        [FromBody] AddExcludedUserRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.UserId))
            return BadRequest("A user id is required.");

        var createdBy = GetCurrentUserShortName() ?? "unknown";
        var added = await _service.AddExcludedUserAsync(request.UserId, request.Reason, createdBy, cancellationToken);
        if (added is null)
            return Conflict("That user is already excluded.");

        return CreatedAtAction(nameof(GetExcludedUsers), new { }, added);
    }

    [HttpDelete("excluded-users/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult> RemoveExcludedUser(int id, CancellationToken cancellationToken = default)
        => await _service.RemoveExcludedUserAsync(id, cancellationToken) ? NoContent() : NotFound();

    // Telemetry endpoint — every signed-in user posts click events from the UI,
    // not just Admin. Intentionally left without the per-method AdminOnly policy
    // so the class-level `[Authorize]` (any authenticated user) applies. Writes to a
    // bounded channel (no DbContext) drained by the usage-tracking background service.
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
            TargetId = TelemetrySanitizer.Redact(request.TargetId, request.SubFeatureCode),
            Timestamp = DateTime.UtcNow
        });

        return Accepted();
    }

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
