using Microsoft.AspNetCore.Mvc;
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access;
using GrainOriginatorPortal.Api.Modules.UsageAnalytics.Models;
using GrainOriginatorPortal.Api.Modules.UsageAnalytics.Models.Requests;
using GrainOriginatorPortal.Api.Modules.UsageAnalytics.Services;
using GrainOriginatorPortal.Api.Platform.Exceptions;

namespace GrainOriginatorPortal.Api.Modules.UsageAnalytics.Controllers;

[ApiController]
[Route("api/usage-dashboard")]
// Reading the dashboard requires usage-reports:read. Exclusion administration also requires usage-exclusions:manage.
// Everyone who may read sees the whole organisation and may narrow it to any manager's team with
// `managerId` and/or to job titles with `jobTitles` — there is no per-caller scoping beyond the permission.
// The UI's click events are recorded by ClickEventsController, on the same route prefix, which needs only a sign-in.
[RequirePermission(AppPermissions.UsageAnalytics.UsageReportsRead)]
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
    // subtree, manager included; omitted means the whole organisation. Unknown ids yield empty
    // results rather than errors.
    //
    // `jobTitles` (repeated: ?jobTitles=A&jobTitles=B, keys from /job-titles) narrows every panel to
    // people whose latest recorded job title is one of them; the key "__no_title__" selects people
    // with no recorded title. Repeated rather than comma-joined because directory titles can
    // contain commas. Omitted or empty means no job-title filter. The two filters intersect. The
    // app-wide trade-unit selection is deliberately not an input here.

    [HttpGet("summary")]
    public async Task<ActionResult<UsageDashboardSummaryDto>> GetSummary(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? managerId = null,
        [FromQuery] string[]? jobTitles = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetSummaryAsync(from, to, managerId, jobTitles, cancellationToken));

    [HttpGet("users")]
    public async Task<ActionResult<List<UsageDashboardUserDto>>> GetUsers(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? managerId = null,
        [FromQuery] string[]? jobTitles = null,
        [FromQuery] string? status = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetUsersAsync(from, to, managerId, jobTitles, status, cancellationToken));

    [HttpGet("daily-active")]
    public async Task<ActionResult<List<DailyActiveDto>>> GetDailyActive(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? managerId = null,
        [FromQuery] string[]? jobTitles = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetDailyActiveAsync(from, to, managerId, jobTitles, cancellationToken));

    [HttpGet("feature-sessions")]
    public async Task<ActionResult<List<FeatureSessionsDto>>> GetFeatureSessions(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? managerId = null,
        [FromQuery] string[]? jobTitles = null,
        [FromQuery] string? screen = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetFeatureSessionsAsync(from, to, managerId, jobTitles, screen, cancellationToken));

    // Trend view over whole calendar weeks — deliberately not bound to the dashboard's date filter.
    [HttpGet("weekly-trend")]
    public async Task<ActionResult<List<WeeklyTrendDto>>> GetWeeklyTrend(
        [FromQuery] string? managerId = null,
        [FromQuery] string[]? jobTitles = null,
        [FromQuery] int weeks = 8,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetWeeklyTrendAsync(managerId, jobTitles, weeks, cancellationToken));

    [HttpGet("activity-breakdown")]
    public async Task<ActionResult<List<ActivityBreakdownDto>>> GetActivityBreakdown(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? managerId = null,
        [FromQuery] string[]? jobTitles = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetActivityBreakdownAsync(from, to, managerId, jobTitles, cancellationToken));

    [HttpGet("underused-features")]
    public async Task<ActionResult<List<UnderusedFeatureDto>>> GetUnderusedFeatures(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? managerId = null,
        [FromQuery] string[]? jobTitles = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetUnderusedFeaturesAsync(from, to, managerId, jobTitles, cancellationToken));

    [HttpGet("query-library-usage")]
    public async Task<ActionResult<List<QueryLibraryUsageDto>>> GetQueryLibraryUsage(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? managerId = null,
        [FromQuery] string[]? jobTitles = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetQueryLibraryUsageAsync(from, to, managerId, jobTitles, cancellationToken));

    [HttpGet("query-search-gaps")]
    public async Task<ActionResult<List<QuerySearchGapDto>>> GetQuerySearchGaps(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to,
        [FromQuery] string? managerId = null,
        [FromQuery] string[]? jobTitles = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetQuerySearchGapsAsync(from, to, managerId, jobTitles, cancellationToken));

    /// <summary>Active managers for the manager filter. 503 when the TradeUnitPreferences DB is
    /// unreachable — fail closed, so the client shows "unavailable" instead of a stale roster.</summary>
    [HttpGet("managers")]
    public async Task<ActionResult<List<UsageManagerDto>>> GetManagers(CancellationToken cancellationToken = default)
        => Ok(await _service.GetManagersAsync(cancellationToken));

    /// <summary>Options for the job-title filter, with user counts inside the selected manager's team
    /// (or the whole organisation). Titles come from the token claim the usage middleware records,
    /// so someone who has not signed in since that shipped appears under "No title". Covered by the
    /// class-level usage-reports:read permission, like the manager roster.</summary>
    [HttpGet("job-titles")]
    public async Task<ActionResult<List<UsageJobTitleDto>>> GetJobTitles(
        [FromQuery] string? managerId = null,
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetJobTitlesAsync(managerId, cancellationToken));

    // Per-user drill-down. Aggregates one originator's full activity profile in the window.
    [HttpGet("users/{userId}/detail")]
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
