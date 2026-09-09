using System.Threading.Channels;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using GrainOriginatorPortal.Api.Authorization;
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/usage-dashboard")]
// Baseline: any authenticated user. Individual data-read endpoints require the
// UsageDashboardViewer policy (the Admin app role, granted by the "Origination App {Env} Super
// Users" group), applied per method because ASP.NET combines Authorize attributes with
// AND — a class-level policy would also block the telemetry endpoint below, which
// needs to accept click events from every signed-in user for user-activity tracking.
// Exclusion administration stays AdminOnly (+ the ExclusionManagers allowlist).
// These policies decide who may CALL a read. How much of the org each read returns is a separate
// concern, scoped per caller in UsageDashboardService against UsageDashboard:ViewAll.
[Authorize]
[Produces("application/json")]
public class UsageDashboardController : ControllerBase
{
    private readonly IUsageDashboardService _service;
    private readonly HashSet<string> _exclusionManagers;

    public UsageDashboardController(IUsageDashboardService service, IConfiguration configuration)
    {
        _service = service;
        // The short list of IT users allowed to manage the exclusion list — a tighter circle than
        // the Admin role that gates the rest of the dashboard.
        _exclusionManagers = new HashSet<string>(
            configuration.GetSection("UsageDashboard:ExclusionManagers").Get<string[]>() ?? [],
            StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Whether the signed-in user is on the configured exclusion-manager allowlist.</summary>
    private bool IsExclusionManager()
    {
        var shortName = GetCurrentUserShortName();
        return !string.IsNullOrEmpty(shortName) && _exclusionManagers.Contains(shortName);
    }

    // `from`/`to` are calendar dates (yyyy-MM-dd) interpreted in UTC; the window is
    // [from 00:00Z, to+1day 00:00Z), so from == to is one full day. Binding DateOnly rather than
    // DateTime keeps the boundary from shifting with the server's local timezone.
    //
    // `managerId` (a short name from /managers) narrows every panel to that manager's entire org
    // subtree, manager included. Unknown ids yield empty results rather than errors.

    [HttpGet("summary")]
    [Authorize(Policy = UsageDashboardAccess.PolicyName)]
    public async Task<ActionResult<UsageDashboardSummaryDto>> GetSummary(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? tradeUnitKey = null, [FromQuery] string? managerId = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetSummaryAsync(from, to, tradeUnitKey, managerId, cancellationToken));

    [HttpGet("users")]
    [Authorize(Policy = UsageDashboardAccess.PolicyName)]
    public async Task<ActionResult<List<UsageDashboardUserDto>>> GetUsers(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? tradeUnitKey = null, [FromQuery] string? managerId = null,
        [FromQuery] string? status = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetUsersAsync(from, to, tradeUnitKey, managerId, status, cancellationToken));

    [HttpGet("daily-active")]
    [Authorize(Policy = UsageDashboardAccess.PolicyName)]
    public async Task<ActionResult<List<DailyActiveDto>>> GetDailyActive(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? tradeUnitKey = null, [FromQuery] string? managerId = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetDailyActiveAsync(from, to, tradeUnitKey, managerId, cancellationToken));

    [HttpGet("feature-sessions")]
    [Authorize(Policy = UsageDashboardAccess.PolicyName)]
    public async Task<ActionResult<List<FeatureSessionsDto>>> GetFeatureSessions(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? tradeUnitKey = null, [FromQuery] string? managerId = null,
        [FromQuery] string? screen = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetFeatureSessionsAsync(from, to, tradeUnitKey, managerId, screen, cancellationToken));

    // Trend view over whole calendar weeks — deliberately not bound to the dashboard's date filter.
    [HttpGet("weekly-trend")]
    [Authorize(Policy = UsageDashboardAccess.PolicyName)]
    public async Task<ActionResult<List<WeeklyTrendDto>>> GetWeeklyTrend(
        [FromQuery] string? tradeUnitKey = null, [FromQuery] string? managerId = null,
        [FromQuery] int weeks = 8,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetWeeklyTrendAsync(tradeUnitKey, managerId, weeks, cancellationToken));

    [HttpGet("activity-breakdown")]
    [Authorize(Policy = UsageDashboardAccess.PolicyName)]
    public async Task<ActionResult<List<ActivityBreakdownDto>>> GetActivityBreakdown(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? tradeUnitKey = null, [FromQuery] string? managerId = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetActivityBreakdownAsync(from, to, tradeUnitKey, managerId, cancellationToken));

    [HttpGet("underused-features")]
    [Authorize(Policy = UsageDashboardAccess.PolicyName)]
    public async Task<ActionResult<List<UnderusedFeatureDto>>> GetUnderusedFeatures(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? tradeUnitKey = null, [FromQuery] string? managerId = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetUnderusedFeaturesAsync(from, to, tradeUnitKey, managerId, cancellationToken));

    [HttpGet("query-library-usage")]
    [Authorize(Policy = UsageDashboardAccess.PolicyName)]
    public async Task<ActionResult<List<QueryLibraryUsageDto>>> GetQueryLibraryUsage(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? tradeUnitKey = null, [FromQuery] string? managerId = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetQueryLibraryUsageAsync(from, to, tradeUnitKey, managerId, cancellationToken));

    [HttpGet("query-search-gaps")]
    [Authorize(Policy = UsageDashboardAccess.PolicyName)]
    public async Task<ActionResult<List<QuerySearchGapDto>>> GetQuerySearchGaps(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? tradeUnitKey = null, [FromQuery] string? managerId = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetQuerySearchGapsAsync(from, to, tradeUnitKey, managerId, cancellationToken));

    /// <summary>Active managers for the manager filter. 503 when the TradeUnitPreferences DB is
    /// unreachable — fail closed, so the client shows "unavailable" instead of a stale roster.</summary>
    [HttpGet("managers")]
    [Authorize(Policy = UsageDashboardAccess.PolicyName)]
    public async Task<ActionResult<List<UsageManagerDto>>> GetManagers(CancellationToken cancellationToken = default)
        => Ok(await _service.GetManagersAsync(cancellationToken));

    // Per-user drill-down. Aggregates one originator's full activity profile in the window.
    [HttpGet("users/{userId}/detail")]
    [Authorize(Policy = UsageDashboardAccess.PolicyName)]
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
    //
    // These endpoints are gated TWICE: AdminOnly (like the rest of the dashboard) AND the
    // UsageDashboard:ExclusionManagers allowlist — only the named IT users may see or change the
    // exclusion list. The client asks /excluded-users/can-manage and hides the gear for everyone else.

    /// <summary>Whether the caller may manage exclusions — drives the gear icon's visibility.</summary>
    // Viewer policy (not AdminOnly) so non-admin viewers get a clean `false` instead of a 403 on
    // page load; the answer is still the ExclusionManagers allowlist check either way.
    [HttpGet("excluded-users/can-manage")]
    [Authorize(Policy = UsageDashboardAccess.PolicyName)]
    public ActionResult<ExclusionPermissionsDto> GetCanManageExclusions()
        => Ok(new ExclusionPermissionsDto { CanManage = IsExclusionManager() });

    // People who can sign in to the app (Entra access-group members), for the exclusion picker so an
    // admin can search + select instead of typing a user id. Available=false ⇒ client falls to free text.
    [HttpGet("access-users")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<AccessUsersDto>> GetAccessUsers(CancellationToken cancellationToken = default)
    {
        if (!IsExclusionManager()) return Forbid();
        return Ok(await _service.GetAccessUsersAsync(cancellationToken));
    }

    [HttpGet("excluded-users")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<ExcludedUserDto>>> GetExcludedUsers(CancellationToken cancellationToken = default)
    {
        if (!IsExclusionManager()) return Forbid();
        return Ok(await _service.GetExcludedUsersAsync(cancellationToken));
    }

    [HttpPost("excluded-users")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<ExcludedUserDto>> AddExcludedUser(
        [FromBody] AddExcludedUserRequest request, CancellationToken cancellationToken = default)
    {
        if (!IsExclusionManager()) return Forbid();
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
    {
        if (!IsExclusionManager()) return Forbid();
        return await _service.RemoveExcludedUserAsync(id, cancellationToken) ? NoContent() : NotFound();
    }

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
