using System.Threading.Channels;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Infrastructure.Platform.Access;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/usage-dashboard")]
// Baseline: any authenticated user. Each data-read endpoint requires usage-reports:read, applied per
// method because ASP.NET requires every authorization attribute that applies: one on the class would
// also block the telemetry endpoint below, which accepts click events from every signed-in user.
// Exclusion administration requires usage-exclusions:manage instead.
// Everyone who may read sees the whole organisation and may narrow it to any manager's team with
// `managerId` — there is no per-caller scoping beyond the permission.
[Authorize]
[Produces("application/json")]
public class UsageDashboardController : ControllerBase
{
    private readonly IUsageDashboardService _service;
    private readonly IPermissionService _permissions;

    public UsageDashboardController(IUsageDashboardService service, IPermissionService permissions)
    {
        _service = service;
        _permissions = permissions;
    }

    // `from`/`to` are calendar dates (yyyy-MM-dd) interpreted in UTC; the window is
    // [from 00:00Z, to+1day 00:00Z), so from == to is one full day. Binding DateOnly rather than
    // DateTime keeps the boundary from shifting with the server's local timezone.
    //
    // `managerId` (a short name from /managers) narrows every panel to that manager's entire org
    // subtree, manager included; omitted means the whole organisation. It is the dashboard's only
    // filter — the app-wide trade-unit selection is deliberately not an input here. Unknown ids
    // yield empty results rather than errors.

    [HttpGet("summary")]
    [RequirePermission(AppPermissions.UsageAnalytics.UsageReportsRead)]
    public async Task<ActionResult<UsageDashboardSummaryDto>> GetSummary(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? managerId = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetSummaryAsync(from, to, managerId, cancellationToken));

    [HttpGet("users")]
    [RequirePermission(AppPermissions.UsageAnalytics.UsageReportsRead)]
    public async Task<ActionResult<List<UsageDashboardUserDto>>> GetUsers(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? managerId = null,
        [FromQuery] string? status = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetUsersAsync(from, to, managerId, status, cancellationToken));

    [HttpGet("daily-active")]
    [RequirePermission(AppPermissions.UsageAnalytics.UsageReportsRead)]
    public async Task<ActionResult<List<DailyActiveDto>>> GetDailyActive(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? managerId = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetDailyActiveAsync(from, to, managerId, cancellationToken));

    [HttpGet("feature-sessions")]
    [RequirePermission(AppPermissions.UsageAnalytics.UsageReportsRead)]
    public async Task<ActionResult<List<FeatureSessionsDto>>> GetFeatureSessions(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? managerId = null,
        [FromQuery] string? screen = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetFeatureSessionsAsync(from, to, managerId, screen, cancellationToken));

    // Trend view over whole calendar weeks — deliberately not bound to the dashboard's date filter.
    [HttpGet("weekly-trend")]
    [RequirePermission(AppPermissions.UsageAnalytics.UsageReportsRead)]
    public async Task<ActionResult<List<WeeklyTrendDto>>> GetWeeklyTrend(
        [FromQuery] string? managerId = null,
        [FromQuery] int weeks = 8,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetWeeklyTrendAsync(managerId, weeks, cancellationToken));

    [HttpGet("activity-breakdown")]
    [RequirePermission(AppPermissions.UsageAnalytics.UsageReportsRead)]
    public async Task<ActionResult<List<ActivityBreakdownDto>>> GetActivityBreakdown(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? managerId = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetActivityBreakdownAsync(from, to, managerId, cancellationToken));

    [HttpGet("underused-features")]
    [RequirePermission(AppPermissions.UsageAnalytics.UsageReportsRead)]
    public async Task<ActionResult<List<UnderusedFeatureDto>>> GetUnderusedFeatures(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? managerId = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetUnderusedFeaturesAsync(from, to, managerId, cancellationToken));

    [HttpGet("query-library-usage")]
    [RequirePermission(AppPermissions.UsageAnalytics.UsageReportsRead)]
    public async Task<ActionResult<List<QueryLibraryUsageDto>>> GetQueryLibraryUsage(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? managerId = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetQueryLibraryUsageAsync(from, to, managerId, cancellationToken));

    [HttpGet("query-search-gaps")]
    [RequirePermission(AppPermissions.UsageAnalytics.UsageReportsRead)]
    public async Task<ActionResult<List<QuerySearchGapDto>>> GetQuerySearchGaps(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? managerId = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetQuerySearchGapsAsync(from, to, managerId, cancellationToken));

    /// <summary>Active managers for the manager filter. 503 when the TradeUnitPreferences DB is
    /// unreachable — fail closed, so the client shows "unavailable" instead of a stale roster.</summary>
    [HttpGet("managers")]
    [RequirePermission(AppPermissions.UsageAnalytics.UsageReportsRead)]
    public async Task<ActionResult<List<UsageManagerDto>>> GetManagers(CancellationToken cancellationToken = default)
        => Ok(await _service.GetManagersAsync(cancellationToken));

    // Per-user drill-down. Aggregates one originator's full activity profile in the window.
    [HttpGet("users/{userId}/detail")]
    [RequirePermission(AppPermissions.UsageAnalytics.UsageReportsRead)]
    public async Task<ActionResult<UserUsageDetailDto>> GetUserDetail(
        string userId,
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        CancellationToken cancellationToken = default)
    {
        var detail = await _service.GetUserDetailAsync(userId, from, to, cancellationToken);
        if (detail is null) return NotFound();
        return Ok(detail);
    }

    // ── Excluded users ──
    // Accounts kept out of every dashboard view (IT/dev/admin accounts whose activity would skew
    // adoption). Excluding someone changes nothing about their access to the app.
    //
    // These endpoints require usage-exclusions:manage, which IT holds. Reading the dashboard isn't
    // enough to see or change the exclusion list. The client asks /excluded-users/can-manage and
    // hides the gear for everyone else.

    /// <summary>Whether the caller may manage exclusions — drives the gear icon's visibility.</summary>
    // Needs only usage-reports:read, so a reader who can't manage gets a clean `false` instead of a 403
    // on page load.
    [HttpGet("excluded-users/can-manage")]
    [RequirePermission(AppPermissions.UsageAnalytics.UsageReportsRead)]
    public async Task<ActionResult<ExclusionPermissionsDto>> GetCanManageExclusions(CancellationToken cancellationToken = default)
        => Ok(new ExclusionPermissionsDto
        {
            CanManage = await _permissions.HasPermissionAsync(AppPermissions.UsageAnalytics.UsageExclusionsManage, cancellationToken),
        });

    // People who can sign in to the app (Entra access-group members), for the exclusion picker so an
    // admin can search + select instead of typing a user id. Available=false ⇒ client falls to free text.
    [HttpGet("access-users")]
    [RequirePermission(AppPermissions.UsageAnalytics.UsageExclusionsManage)]
    public async Task<ActionResult<AccessUsersDto>> GetAccessUsers(CancellationToken cancellationToken = default)
        => Ok(await _service.GetAccessUsersAsync(cancellationToken));

    [HttpGet("excluded-users")]
    [RequirePermission(AppPermissions.UsageAnalytics.UsageExclusionsManage)]
    public async Task<ActionResult<List<ExcludedUserDto>>> GetExcludedUsers(CancellationToken cancellationToken = default)
        => Ok(await _service.GetExcludedUsersAsync(cancellationToken));

    [HttpPost("excluded-users")]
    [RequirePermission(AppPermissions.UsageAnalytics.UsageExclusionsManage)]
    public async Task<ActionResult<ExcludedUserDto>> AddExcludedUser(
        [FromBody] AddExcludedUserRequest request, CancellationToken cancellationToken = default)
    {
        // Throw rather than return a bare string: ASP.NET serializes a string body as raw JSON,
        // which the Angular client's error unwrapping can't read, so the user saw a generic
        // "Server error" instead of this text. Going through GlobalExceptionHandler puts it in the
        // standard envelope the client already parses.
        if (string.IsNullOrWhiteSpace(request.UserId))
            throw new ValidationException(nameof(request.UserId), "A user id is required.");

        var createdBy = GetCurrentUserShortName() ?? "unknown";
        var added = await _service.AddExcludedUserAsync(request.UserId, request.Reason, createdBy, cancellationToken);
        if (added is null)
            throw new BusinessException("That user is already excluded.", "USER_ALREADY_EXCLUDED");

        return CreatedAtAction(nameof(GetExcludedUsers), new { }, added);
    }

    [HttpDelete("excluded-users/{id:int}")]
    [RequirePermission(AppPermissions.UsageAnalytics.UsageExclusionsManage)]
    public async Task<ActionResult> RemoveExcludedUser(int id, CancellationToken cancellationToken = default)
        => await _service.RemoveExcludedUserAsync(id, cancellationToken) ? NoContent() : NotFound();

    // Telemetry endpoint — every signed-in user posts click events from the UI. Intentionally left
    // without a permission so the class-level `[Authorize]` (any authenticated user) applies. Writes to a
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
