using System.Threading.Channels;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/usage-dashboard")]
// Baseline: any authenticated user. Individual data-read endpoints require the
// `Admin` app role (applied as `[Authorize(Policy = "AdminOnly")]` per method)
// because ASP.NET combines Authorize attributes with AND — a class-level
// AdminOnly would also block the telemetry endpoint below, which needs to
// accept click events from every signed-in user for user-activity tracking.
// Per developer-docs/ENTRA-ID-GROUPS-GUIDE.md, the "Origination App Dev Super
// Users" security group is assigned the `Admin` role on the API Enterprise
// Application, so its members receive `"roles": ["Admin"]` in their token
// and are permitted on the GETs.
[Authorize]
[Produces("application/json")]
public class UsageDashboardController : ControllerBase
{
    private readonly ApplicationDbContext _appDb;
    private readonly OriginationDbContext _odsDb;
    private readonly IMemoryCache _cache;
    private readonly ILogger<UsageDashboardController> _logger;

    public UsageDashboardController(
        ApplicationDbContext appDb,
        OriginationDbContext odsDb,
        IMemoryCache cache,
        ILogger<UsageDashboardController> logger)
    {
        _appDb = appDb;
        _odsDb = odsDb;
        _cache = cache;
        _logger = logger;
    }

    /// <summary>Intersects the snapshot-derived user set with the cached app-access group members
    /// (members of the per-environment app-access AAD group). Fail-open: when no app-access set is
    /// cached (filter disabled, or Graph never succeeded), the input is returned unchanged so the
    /// dashboard shows all entitlements users rather than going blank.</summary>
    internal static HashSet<string> ApplyAppAccessFilter(HashSet<string> snapshotUsers, IReadOnlySet<string>? appAccessUsers)
    {
        if (appAccessUsers is not { Count: > 0 }) return snapshotUsers;
        return new HashSet<string>(snapshotUsers.Where(appAccessUsers.Contains), StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Returns a set of UserIds filtered by trade unit codes (or all if none specified).</summary>
    private async Task<HashSet<string>> GetFilteredUserIdsAsync(string? tradeUnitKey, CancellationToken ct)
    {
        HashSet<string> snapshotUsers;
        if (string.IsNullOrWhiteSpace(tradeUnitKey))
        {
            var all = await _appDb.UserTradeUnitSnapshots.Select(s => s.UserId).Distinct().ToListAsync(ct);
            snapshotUsers = new HashSet<string>(all, StringComparer.OrdinalIgnoreCase);
        }
        else
        {
            var codes = tradeUnitKey.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
            var filtered = await _appDb.UserTradeUnitSnapshots
                .Where(s => codes.Contains(s.TradeUnitCode))
                .Select(s => s.UserId)
                .Distinct()
                .ToListAsync(ct);
            snapshotUsers = new HashSet<string>(filtered, StringComparer.OrdinalIgnoreCase);
        }

        // Limit to users who actually have access to this application (members of the per-environment
        // app-access AAD group, cached hourly from Graph by UsageAggregationBackgroundService).
        var appAccessUsers = _cache.Get<IReadOnlySet<string>>(UsageAggregationBackgroundService.AppAccessUsersCacheKey);
        return ApplyAppAccessFilter(snapshotUsers, appAccessUsers);
    }

    /// <summary>Returns display name lookup from the snapshot table.</summary>
    private async Task<Dictionary<string, string>> GetDisplayNameLookupAsync(HashSet<string> userIds, CancellationToken ct)
    {
        var snapshots = await _appDb.UserTradeUnitSnapshots
            .Where(s => userIds.Contains(s.UserId))
            .Select(s => new { s.UserId, s.DisplayName })
            .Distinct()
            .ToListAsync(ct);
        return snapshots
            .GroupBy(s => s.UserId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().DisplayName, StringComparer.OrdinalIgnoreCase);
    }

    [HttpGet("summary")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<UsageDashboardSummaryDto>> GetSummary(
        [FromQuery] DateTime from, [FromQuery] DateTime to,
        [FromQuery] string? tradeUnitKey = null, CancellationToken ct = default)
    {
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime().Date.AddDays(1);
        var userIds = await GetFilteredUserIdsAsync(tradeUnitKey, ct);
        var totalUsers = userIds.Count;

        var activeUserIds = await _appDb.UserActivities
            .Where(a => a.Timestamp >= fromUtc && a.Timestamp < toUtc && userIds.Contains(a.UserId))
            .Select(a => a.UserId).Distinct().ToListAsync(ct);
        var activeUsers = activeUserIds.Count;

        var adoptionRate = totalUsers > 0 ? Math.Round((double)activeUsers / totalUsers * 100, 1) : 0;

        var sessions = await _appDb.UserSessions
            .Where(s => s.LoginTime >= fromUtc && s.LoginTime < toUtc && userIds.Contains(s.UserId))
            .ToListAsync(ct);

        var totalWeeks = Math.Max(1, (toUtc - fromUtc).TotalDays / 7.0);
        var avgLoginsPerWeek = sessions.Count > 0 ? Math.Round(sessions.Count / totalWeeks, 1) : 0;
        var avgSessionMinutes = sessions.Count > 0 ? Math.Round(sessions.Average(s => s.DurationMinutes), 1) : 0;

        var sevenDaysAgo = DateTime.UtcNow.AddDays(-7);
        var needsAttention = userIds.Count(uid =>
            !activeUserIds.Contains(uid) ||
            !activeUserIds.Any(a => string.Equals(a, uid, StringComparison.OrdinalIgnoreCase)));

        return Ok(new UsageDashboardSummaryDto
        {
            AdoptionRate = adoptionRate,
            AvgLoginsPerWeek = avgLoginsPerWeek,
            AvgSessionMinutes = avgSessionMinutes,
            TotalUsers = totalUsers,
            ActiveUsers = activeUsers,
            NeedsAttentionCount = totalUsers - activeUsers
        });
    }

    [HttpGet("users")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<UsageDashboardUserDto>>> GetUsers(
        [FromQuery] DateTime from, [FromQuery] DateTime to,
        [FromQuery] string? tradeUnitKey = null, [FromQuery] string? status = null,
        CancellationToken ct = default)
    {
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime().Date.AddDays(1);
        var userIds = await GetFilteredUserIdsAsync(tradeUnitKey, ct);
        var displayNames = await GetDisplayNameLookupAsync(userIds, ct);

        var activityByUser = await _appDb.UserActivities
            .Where(a => a.Timestamp >= fromUtc && a.Timestamp < toUtc && userIds.Contains(a.UserId))
            .GroupBy(a => a.UserId)
            .Select(g => new { UserId = g.Key, LastActive = g.Max(a => a.Timestamp) })
            .ToListAsync(ct);
        var activityLookup = activityByUser.ToDictionary(a => a.UserId, StringComparer.OrdinalIgnoreCase);

        var sessionsByUser = await _appDb.UserSessions
            .Where(s => s.LoginTime >= fromUtc && s.LoginTime < toUtc && userIds.Contains(s.UserId))
            .GroupBy(s => s.UserId)
            .Select(g => new { UserId = g.Key, LoginCount = g.Count(), AvgDuration = g.Average(s => (double)s.DurationMinutes) })
            .ToListAsync(ct);
        var sessionLookup = sessionsByUser.ToDictionary(s => s.UserId, StringComparer.OrdinalIgnoreCase);

        // Customers contacted: call + email click events (per user, date filtered, NOT trade-unit filtered)
        var clicksByUser = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= fromUtc && c.Timestamp < toUtc
                && (c.EventType == "call_click" || c.EventType == "email_click"))
            .GroupBy(c => c.UserId)
            .Select(g => new { UserId = g.Key, ContactCount = g.Count() })
            .ToListAsync(ct);
        var clicksLookup = clicksByUser.ToDictionary(c => c.UserId, StringComparer.OrdinalIgnoreCase);

        // Notes created: count POST /api/notes from UserActivity (per user, date filtered, NOT trade-unit filtered)
        // This uses the normalized UserId which is reliable, unlike Notes.CreatedBy which stores display names
        var notesByUser = await _appDb.UserActivities
            .Where(a => a.Timestamp >= fromUtc && a.Timestamp < toUtc
                && a.SubFeatureCode == "notes-create" && a.HttpMethod == "POST")
            .GroupBy(a => a.UserId)
            .Select(g => new { UserId = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        var notesLookup = notesByUser.ToDictionary(n => n.UserId, n => n.Count, StringComparer.OrdinalIgnoreCase);

        var sevenDaysAgo = DateTime.UtcNow.AddDays(-7);
        var result = new List<UsageDashboardUserDto>();

        foreach (var userId in userIds)
        {
            var hasActivity = activityLookup.TryGetValue(userId, out var activity);
            var hasSession = sessionLookup.TryGetValue(userId, out var session);
            clicksLookup.TryGetValue(userId, out var clicks);
            notesLookup.TryGetValue(userId, out var noteCount);

            string userStatus = !hasActivity ? "Never Logged In"
                : activity!.LastActive >= sevenDaysAgo ? "Active" : "Inactive";

            if (!string.IsNullOrEmpty(status) && !string.Equals(status, "all", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(status, userStatus, StringComparison.OrdinalIgnoreCase))
                continue;

            result.Add(new UsageDashboardUserDto
            {
                UserId = userId,
                DisplayName = displayNames.GetValueOrDefault(userId, userId),
                LoginCount = hasSession ? session!.LoginCount : 0,
                LastActive = hasActivity ? activity!.LastActive : null,
                AvgSessionMinutes = hasSession ? Math.Round(session!.AvgDuration, 1) : 0,
                Status = userStatus,
                CustomersContacted = clicks?.ContactCount ?? 0,
                NotesCreated = noteCount
            });
        }

        return Ok(result.OrderByDescending(u => u.LastActive ?? DateTime.MinValue).ToList());
    }

    [HttpGet("daily-active")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<DailyActiveDto>>> GetDailyActive(
        [FromQuery] DateTime from, [FromQuery] DateTime to,
        [FromQuery] string? tradeUnitKey = null, CancellationToken ct = default)
    {
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime().Date.AddDays(1);
        var userIds = await GetFilteredUserIdsAsync(tradeUnitKey, ct);

        // Query raw UserActivity for real-time data
        var activities = await _appDb.UserActivities
            .Where(a => a.Timestamp >= fromUtc && a.Timestamp < toUtc && userIds.Contains(a.UserId))
            .Select(a => new { a.UserId, Date = a.Timestamp.Date })
            .Distinct()
            .ToListAsync(ct);

        var dailyCounts = activities
            .GroupBy(a => a.Date)
            .ToDictionary(g => DateOnly.FromDateTime(g.Key), g => g.Select(a => a.UserId).Distinct().Count());

        var fromDate = DateOnly.FromDateTime(fromUtc);
        var toDate = DateOnly.FromDateTime(toUtc);
        var result = new List<DailyActiveDto>();
        for (var d = fromDate; d < toDate; d = d.AddDays(1))
        {
            dailyCounts.TryGetValue(d, out var count);
            result.Add(new DailyActiveDto { Date = d.ToString("yyyy-MM-dd"), UniqueUserCount = count });
        }

        return Ok(result);
    }

    [HttpGet("feature-sessions")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<FeatureSessionsDto>>> GetFeatureSessions(
        [FromQuery] DateTime from, [FromQuery] DateTime to,
        [FromQuery] string? tradeUnitKey = null, [FromQuery] string? screen = null,
        CancellationToken ct = default)
    {
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime().Date.AddDays(1);
        var userIds = await GetFilteredUserIdsAsync(tradeUnitKey, ct);

        // --- TIME SPENT per screen ---
        // Uses explicit screen_enter events from the frontend (fired on every Angular route navigation).
        // Time on screen N = timestamp of screen_enter N+1 - timestamp of screen_enter N (capped at 30 min).
        var screenEnterEvents = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= fromUtc && c.Timestamp < toUtc
                && c.EventType == "screen_enter" && userIds.Contains(c.UserId))
            .Select(c => new { c.UserId, c.FeatureCode, c.Timestamp })
            .OrderBy(c => c.UserId).ThenBy(c => c.Timestamp)
            .ToListAsync(ct);

        var timePerFeature = new Dictionary<string, double>();

        foreach (var userGroup in screenEnterEvents.GroupBy(e => e.UserId))
        {
            var events = userGroup.OrderBy(e => e.Timestamp).ToList();
            for (int i = 0; i < events.Count - 1; i++)
            {
                var timeOnScreen = (events[i + 1].Timestamp - events[i].Timestamp).TotalMinutes;
                if (timeOnScreen > 0 && timeOnScreen <= 30) // cap at 30 min (idle = session ended)
                {
                    timePerFeature[events[i].FeatureCode] = timePerFeature.GetValueOrDefault(events[i].FeatureCode) + timeOnScreen;
                }
            }
            // Last screen: give 1 minute minimum
            if (events.Count > 0)
            {
                timePerFeature[events[^1].FeatureCode] = timePerFeature.GetValueOrDefault(events[^1].FeatureCode) + 1;
            }
        }

        // --- SUB-FEATURE COUNTS from explicit click events ---
        var clickQuery = _appDb.UserClickEvents
            .Where(c => c.Timestamp >= fromUtc && c.Timestamp < toUtc
                && c.EventType == "interaction" && userIds.Contains(c.UserId));

        if (!string.IsNullOrWhiteSpace(screen) && screen != "all")
            clickQuery = clickQuery.Where(c => c.FeatureCode == screen);

        var clickCounts = await clickQuery
            .GroupBy(c => new { c.FeatureCode, c.SubFeatureCode })
            .Select(g => new { g.Key.FeatureCode, SubFeatureCode = g.Key.SubFeatureCode ?? "__total__", Count = g.Count() })
            .ToListAsync(ct);

        // Also count notes-create from UserActivity (POST /api/notes) since that's tracked via middleware
        var notesCreateCounts = await _appDb.UserActivities
            .Where(a => a.Timestamp >= fromUtc && a.Timestamp < toUtc
                && a.SubFeatureCode == "notes-create" && a.HttpMethod == "POST"
                && userIds.Contains(a.UserId))
            .GroupBy(a => a.FeatureCode)
            .Select(g => new { FeatureCode = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        var featureLabels = new Dictionary<string, string>
        {
            ["customers"] = "Customer Page",
            ["dashboard"] = "Planting Intention Dashboard",
            ["build-a-list"] = "Build a List",
            ["insights"] = "Actionable Insights",
            ["bidsheet"] = "Bid Sheet",
            ["position-report"] = "Position Report",
        };

        // Build results: for "all" show time per screen, for specific screen show sub-feature click counts
        if (string.IsNullOrWhiteSpace(screen) || screen == "all")
        {
            // All Features: show time spent per screen
            var result = featureLabels.Select(fl => new FeatureSessionsDto
            {
                FeatureCode = fl.Key,
                FeatureLabel = fl.Value,
                SessionCount = (int)Math.Round(timePerFeature.GetValueOrDefault(fl.Key)),
                SubFeatures = []
            })
            .Where(f => f.SessionCount > 0)
            .OrderByDescending(f => f.SessionCount)
            .ToList();

            return Ok(result);
        }
        else
        {
            // Specific screen: show sub-feature interaction counts
            var subFeatures = clickCounts
                .Where(c => c.FeatureCode == screen && c.SubFeatureCode != "__total__")
                .Select(c => new SubFeatureSessionDto
                {
                    SubFeatureCode = c.SubFeatureCode,
                    Label = FormatSubFeatureLabel(c.SubFeatureCode),
                    SessionCount = c.Count
                })
                .ToList();

            // Add notes-create from activity tracking
            var notesCount = notesCreateCounts.FirstOrDefault(n => n.FeatureCode == screen)?.Count ?? 0;
            if (notesCount > 0)
            {
                var existing = subFeatures.FirstOrDefault(sf => sf.SubFeatureCode == "notes-create");
                if (existing != null) existing.SessionCount += notesCount;
                else subFeatures.Add(new SubFeatureSessionDto { SubFeatureCode = "notes-create", Label = "Notes Created", SessionCount = notesCount });
            }

            var totalTime = (int)Math.Round(timePerFeature.GetValueOrDefault(screen));

            return Ok(new List<FeatureSessionsDto>
            {
                new()
                {
                    FeatureCode = screen,
                    FeatureLabel = featureLabels.GetValueOrDefault(screen, screen),
                    SessionCount = totalTime,
                    SubFeatures = subFeatures.OrderByDescending(sf => sf.SessionCount).ToList()
                }
            });
        }
    }

    [HttpGet("weekly-trend")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<WeeklyTrendDto>>> GetWeeklyTrend(
        [FromQuery] string? tradeUnitKey = null, CancellationToken ct = default)
    {
        var userIds = await GetFilteredUserIdsAsync(tradeUnitKey, ct);
        var eightWeeksAgo = DateTime.UtcNow.AddDays(-56);

        // Query raw UserSession for real-time data
        var sessions = await _appDb.UserSessions
            .Where(s => s.LoginTime >= eightWeeksAgo && userIds.Contains(s.UserId))
            .Select(s => new { s.UserId, s.LoginTime })
            .ToListAsync(ct);

        // Group by week (Monday start)
        var weeklyData = sessions
            .GroupBy(s =>
            {
                var d = s.LoginTime.Date;
                var diff = ((int)d.DayOfWeek + 6) % 7; // Monday = 0
                return d.AddDays(-diff);
            })
            .Select(g => new WeeklyTrendDto
            {
                WeekStart = DateOnly.FromDateTime(g.Key).ToString("yyyy-MM-dd"),
                TotalLogins = g.Select(s => s.UserId).Distinct().Count(),
                TotalSessions = g.Count()
            })
            .OrderBy(w => w.WeekStart)
            .ToList();

        return Ok(weeklyData);
    }

    [HttpGet("activity-breakdown")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<ActivityBreakdownDto>>> GetActivityBreakdown(
        [FromQuery] DateTime from, [FromQuery] DateTime to,
        [FromQuery] string? tradeUnitKey = null, CancellationToken ct = default)
    {
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime().Date.AddDays(1);
        var userIds = await GetFilteredUserIdsAsync(tradeUnitKey, ct);
        var displayNames = await GetDisplayNameLookupAsync(userIds, ct);

        // Notes created and planting intentions added are authoritative via POST API calls
        // (server-side UserActivity log). Everything else is driven by explicit frontend
        // click events (UserClickEvent) so counts reflect user intent — not list-loads.
        var userIdList = userIds.ToList();
        var activityByUser = await _appDb.UserActivities
            .Where(a => a.Timestamp >= fromUtc && a.Timestamp < toUtc && userIdList.Contains(a.UserId))
            .GroupBy(a => a.UserId)
            .Select(g => new
            {
                UserId = g.Key,
                NotesTaken = g.Count(a => a.SubFeatureCode == "notes-create" && a.HttpMethod == "POST"),
                PlantingIntentionsAdded = g.Count(a => a.SubFeatureCode == "planting-intentions" && a.HttpMethod == "POST")
            })
            .ToListAsync(ct);
        var activityMap = activityByUser.ToDictionary(a => a.UserId, StringComparer.OrdinalIgnoreCase);

        // All interaction-style counts come from the explicit click events the UI posts.
        // Fetched into memory so we can do distinct-by-TargetId counts for profiles/contracts
        // (clicking the same customer 5 times in one period = 1 profile viewed, not 5).
        var rawClicks = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= fromUtc && c.Timestamp < toUtc && userIdList.Contains(c.UserId))
            .Select(c => new { c.UserId, c.EventType, c.FeatureCode, c.SubFeatureCode, c.TargetId })
            .ToListAsync(ct);

        var clicksMap = rawClicks.GroupBy(c => c.UserId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => new
            {
                UserId = g.Key,
                // Distinct by TargetId (customerId) — reopening the same profile doesn't re-count
                ProfilesViewed   = g.Where(c => c.FeatureCode == "customers"    && c.SubFeatureCode == "profile-opened"    && c.EventType == "interaction").Select(c => c.TargetId).Distinct().Count(),
                // Distinct by TargetId (contractId) — expanding the same contract row doesn't re-count
                ContractsViewed  = g.Where(c => c.FeatureCode == "customers"    && c.SubFeatureCode == "contracts"         && c.EventType == "interaction").Select(c => c.TargetId).Distinct().Count(),
                // Total count — each call/email click is a distinct action
                CallsEmails      = g.Count(c => c.EventType   == "call_click"   || c.EventType     == "email_click"),
                ListsBuilt       = g.Count(c => c.FeatureCode == "build-a-list" && c.SubFeatureCode == "save-list"),
                ProducerDetails  = g.Count(c => c.FeatureCode == "customers"    && c.SubFeatureCode == "producer-details"  && c.EventType == "interaction")
            }, StringComparer.OrdinalIgnoreCase);

        // Union of user ids that have any tracked activity in the range
        var allUserIds = activityMap.Keys.Union(clicksMap.Keys, StringComparer.OrdinalIgnoreCase).ToList();

        return Ok(allUserIds.Select(id =>
        {
            activityMap.TryGetValue(id, out var a);
            clicksMap.TryGetValue(id, out var c);
            return new ActivityBreakdownDto
            {
                UserId                  = id,
                DisplayName             = displayNames.GetValueOrDefault(id, id),
                ProfilesViewed          = c?.ProfilesViewed          ?? 0,
                ContractsViewed         = c?.ContractsViewed         ?? 0,
                NotesTaken              = a?.NotesTaken              ?? 0,
                CallsEmails             = c?.CallsEmails             ?? 0,
                ListsBuilt              = c?.ListsBuilt              ?? 0,
                PlantingIntentionsAdded = a?.PlantingIntentionsAdded ?? 0,
                ProducerDetails         = c?.ProducerDetails         ?? 0
            };
        }).OrderByDescending(d => d.ProfilesViewed + d.ContractsViewed + d.NotesTaken + d.CallsEmails + d.ListsBuilt + d.PlantingIntentionsAdded + d.ProducerDetails).ToList());
    }

    [HttpGet("inactive")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<UsageDashboardInactiveUserDto>>> GetInactiveUsers(
        [FromQuery] DateTime from, [FromQuery] DateTime to,
        [FromQuery] string? tradeUnitKey = null, [FromQuery] int daysThreshold = 30,
        CancellationToken ct = default)
    {
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime().Date.AddDays(1);
        var userIds = await GetFilteredUserIdsAsync(tradeUnitKey, ct);
        var displayNames = await GetDisplayNameLookupAsync(userIds, ct);

        var lastActivityByUser = await _appDb.UserActivities
            .Where(a => userIds.Contains(a.UserId))
            .GroupBy(a => a.UserId)
            .Select(g => new { UserId = g.Key, LastActive = g.Max(a => a.Timestamp) })
            .ToListAsync(ct);
        var lastActivityLookup = lastActivityByUser.ToDictionary(a => a.UserId, StringComparer.OrdinalIgnoreCase);

        var sessionsByUser = await _appDb.UserSessions
            .Where(s => userIds.Contains(s.UserId))
            .GroupBy(s => s.UserId)
            .Select(g => new { UserId = g.Key, LoginCount = g.Count(), AvgDuration = g.Average(s => (double)s.DurationMinutes) })
            .ToListAsync(ct);
        var sessionLookup = sessionsByUser.ToDictionary(s => s.UserId, StringComparer.OrdinalIgnoreCase);

        var now = DateTime.UtcNow;
        var result = new List<UsageDashboardInactiveUserDto>();

        foreach (var userId in userIds)
        {
            var hasActivity = lastActivityLookup.TryGetValue(userId, out var activity);
            var daysSince = hasActivity ? (int)(now - activity!.LastActive).TotalDays : (int?)null;

            // Skip users who are active within the threshold
            if (hasActivity && daysSince < daysThreshold)
                continue;

            sessionLookup.TryGetValue(userId, out var sessions);

            result.Add(new UsageDashboardInactiveUserDto
            {
                UserId = userId,
                DisplayName = displayNames.GetValueOrDefault(userId, userId),
                DaysSinceLastLogin = daysSince,
                Status = hasActivity ? "Inactive" : "Never Logged In",
                AvgSessionMinutes = sessions != null ? Math.Round(sessions.AvgDuration, 1) : 0,
                LoginCount = sessions?.LoginCount ?? 0
            });
        }

        return Ok(result.OrderByDescending(u => u.DaysSinceLastLogin ?? int.MaxValue).ToList());
    }

    [HttpGet("underused-features")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<UnderusedFeatureDto>>> GetUnderusedFeatures(
        [FromQuery] DateTime from, [FromQuery] DateTime to,
        [FromQuery] string? tradeUnitKey = null, CancellationToken ct = default)
    {
        var fromDate = DateOnly.FromDateTime(from.ToUniversalTime());
        var toDate = DateOnly.FromDateTime(to.ToUniversalTime().Date.AddDays(1));

        var featureLabels = new Dictionary<string, string>
        {
            ["customers"] = "Customer Page",
            ["dashboard"] = "Planting Intention Dashboard",
            ["build-a-list"] = "Build a List",
            ["insights"] = "Actionable Insights",
            ["bidsheet"] = "Bid Sheet",
            ["position-report"] = "Position Report",
        };

        var featureData = await _appDb.FeatureUsageDailies
            .Where(f => f.ActivityDate >= fromDate && f.ActivityDate < toDate && f.SubFeatureCode == "__total__")
            .GroupBy(f => f.FeatureCode)
            .Select(g => new { FeatureCode = g.Key, SessionCount = g.Sum(f => f.SessionCount) })
            .ToListAsync(ct);

        var featureLookup = featureData.ToDictionary(f => f.FeatureCode, StringComparer.OrdinalIgnoreCase);

        // Return all known features, sorted ascending by session count (underused first)
        var result = featureLabels.Select(fl => new UnderusedFeatureDto
        {
            FeatureName = fl.Value,
            SessionCount = featureLookup.TryGetValue(fl.Key, out var f) ? f.SessionCount : 0
        }).OrderBy(f => f.SessionCount).ToList();

        return Ok(result);
    }

    [HttpGet("query-library-usage")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<QueryLibraryUsageDto>>> GetQueryLibraryUsage(
        [FromQuery] DateTime from, [FromQuery] DateTime to,
        [FromQuery] string? tradeUnitKey = null, CancellationToken ct = default)
    {
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime().Date.AddDays(1);
        var userIds = await GetFilteredUserIdsAsync(tradeUnitKey, ct);

        // Group click events by query ID (TargetId) to find most-used library queries
        var rawUsage = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= fromUtc && c.Timestamp < toUtc
                && c.EventType == "interaction"
                && c.FeatureCode == "build-a-list"
                && c.SubFeatureCode == "library-query-selected"
                && c.TargetId != null
                && userIds.Contains(c.UserId))
            .GroupBy(c => c.TargetId!)
            .Select(g => new { QueryId = g.Key, TimesUsed = g.Count() })
            .OrderByDescending(q => q.TimesUsed)
            .ToListAsync(ct);

        // Resolve query IDs to their display name from the QueryLibrary table
        var ids = rawUsage
            .Select(r => int.TryParse(r.QueryId, out var id) ? id : 0)
            .Where(id => id > 0)
            .ToList();
        var names = await _appDb.QueryLibrary
            .Where(q => ids.Contains(q.Id))
            .ToDictionaryAsync(q => q.Id.ToString(), q => q.Name, ct);

        var result = rawUsage.Select(r => new QueryLibraryUsageDto
        {
            QueryText = names.TryGetValue(r.QueryId, out var name) ? name : $"Query #{r.QueryId}",
            TimesUsed = r.TimesUsed
        }).ToList();

        return Ok(result);
    }

    [HttpGet("query-search-gaps")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<List<QuerySearchGapDto>>> GetQuerySearchGaps(
        [FromQuery] DateTime from, [FromQuery] DateTime to,
        [FromQuery] string? tradeUnitKey = null, CancellationToken ct = default)
    {
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime().Date.AddDays(1);
        var userIds = await GetFilteredUserIdsAsync(tradeUnitKey, ct);

        // Shows search terms that didn't match any library query — signal for what to add next
        var gaps = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= fromUtc && c.Timestamp < toUtc
                && c.EventType == "interaction"
                && c.FeatureCode == "build-a-list"
                && c.SubFeatureCode == "library-search-no-match"
                && c.TargetId != null
                && userIds.Contains(c.UserId))
            .GroupBy(c => c.TargetId!)
            .Select(g => new QuerySearchGapDto { SearchText = g.Key, TimesSearched = g.Count() })
            .OrderByDescending(q => q.TimesSearched)
            .Take(20)
            .ToListAsync(ct);

        return Ok(gaps);
    }

    // Per-user drill-down. Aggregates one originator's full activity profile in the
    // window: sessions + per-feature counters + daily series + recent click stream.
    // No new tracking required — all data comes from existing UserActivities and
    // UserClickEvents tables. See developer-docs/Application Context/Usage Dashboard.md.
    [HttpGet("users/{userId}/detail")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<ActionResult<UserUsageDetailDto>> GetUserDetail(
        string userId,
        [FromQuery] DateTime from, [FromQuery] DateTime to,
        [FromQuery] string? tradeUnitKey = null,
        CancellationToken ct = default)
    {
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime().Date.AddDays(1);

        // Confirm the userId is in the allowed set (TU-filtered when a key is provided,
        // all known snapshot users otherwise). If it isn't, the URL was crafted by hand
        // or the snapshot is stale — return 404 rather than leak a partial response.
        var allowedIds = await GetFilteredUserIdsAsync(tradeUnitKey, ct);
        if (!allowedIds.Contains(userId))
            return NotFound();

        var displayNames = await GetDisplayNameLookupAsync(new HashSet<string>(new[] { userId }, StringComparer.OrdinalIgnoreCase), ct);
        var displayName = displayNames.GetValueOrDefault(userId, userId);

        // Sessions in window (drives login count, total time, avg session)
        var sessions = await _appDb.UserSessions
            .Where(s => s.UserId == userId && s.LoginTime >= fromUtc && s.LoginTime < toUtc)
            .Select(s => new { s.DurationMinutes })
            .ToListAsync(ct);

        var loginCount = sessions.Count;
        var totalMinutes = sessions.Sum(s => (double)s.DurationMinutes);
        var avgMinutes = loginCount > 0 ? totalMinutes / loginCount : 0;

        // Last active across all time (status calculation matches GetUsers)
        var lastActive = await _appDb.UserActivities
            .Where(a => a.UserId == userId)
            .OrderByDescending(a => a.Timestamp)
            .Select(a => (DateTime?)a.Timestamp)
            .FirstOrDefaultAsync(ct);

        var sevenDaysAgo = DateTime.UtcNow.AddDays(-7);
        var status = lastActive == null ? "Never Logged In"
            : lastActive >= sevenDaysAgo ? "Active" : "Inactive";

        // All click events for this user in window — partitioned in-memory for many counters.
        // Note: the user has at most a few thousand events per window, so loading once and
        // pivoting in C# is cheaper than dozens of separate filtered queries.
        var clicks = await _appDb.UserClickEvents
            .Where(c => c.UserId == userId && c.Timestamp >= fromUtc && c.Timestamp < toUtc)
            .Select(c => new { c.EventType, c.FeatureCode, c.SubFeatureCode, c.TargetId, c.Timestamp })
            .ToListAsync(ct);

        // Activity events for server-side-tracked actions (notes / planting POSTs)
        var activities = await _appDb.UserActivities
            .Where(a => a.UserId == userId && a.Timestamp >= fromUtc && a.Timestamp < toUtc)
            .Select(a => new { a.SubFeatureCode, a.HttpMethod })
            .ToListAsync(ct);

        // Build daily series (event count + screen minutes)
        var screenEnters = clicks
            .Where(c => c.EventType == "screen_enter")
            .OrderBy(c => c.Timestamp)
            .ToList();

        var screenMinutesPerDay = new Dictionary<DateTime, double>();
        var timePerFeature = new Dictionary<string, double>();
        for (int i = 0; i < screenEnters.Count - 1; i++)
        {
            var time = (screenEnters[i + 1].Timestamp - screenEnters[i].Timestamp).TotalMinutes;
            // Cap at 30 minutes so an idle gap doesn't inflate one screen's total
            if (time > 0 && time <= 30)
            {
                var date = screenEnters[i].Timestamp.Date;
                screenMinutesPerDay[date] = screenMinutesPerDay.GetValueOrDefault(date) + time;
                timePerFeature[screenEnters[i].FeatureCode] = timePerFeature.GetValueOrDefault(screenEnters[i].FeatureCode) + time;
            }
        }
        if (screenEnters.Count > 0)
        {
            var last = screenEnters[^1];
            var date = last.Timestamp.Date;
            screenMinutesPerDay[date] = screenMinutesPerDay.GetValueOrDefault(date) + 1;
            timePerFeature[last.FeatureCode] = timePerFeature.GetValueOrDefault(last.FeatureCode) + 1;
        }

        var dailyEventCounts = clicks
            .GroupBy(c => c.Timestamp.Date)
            .ToDictionary(g => g.Key, g => g.Count());

        var dailyActivity = new List<UserDailyActivityDto>();
        var fromDate = DateOnly.FromDateTime(fromUtc);
        var toDate = DateOnly.FromDateTime(toUtc);
        for (var d = fromDate; d < toDate; d = d.AddDays(1))
        {
            var dt = d.ToDateTime(TimeOnly.MinValue);
            dailyEventCounts.TryGetValue(dt, out var count);
            screenMinutesPerDay.TryGetValue(dt, out var mins);
            dailyActivity.Add(new UserDailyActivityDto
            {
                Date = d.ToString("yyyy-MM-dd"),
                EventCount = count,
                ScreenMinutes = Math.Round(mins, 1)
            });
        }

        // ── Most-interacted producer (per-customer interaction count) ──
        // Tally events whose TargetId is a customer id (profile-opened, tickets,
        // storage, producer-details, call/email clicks). Resolve the top one
        // through dbo.Customer for display.
        var customerInteractionSubFeatures = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "profile-opened", "customer-details", "producer-details", "tickets", "storage"
        };
        var topProducerGroup = clicks
            .Where(c => c.TargetId != null && long.TryParse(c.TargetId, out _) &&
                ((c.FeatureCode == "customers" && c.SubFeatureCode != null && customerInteractionSubFeatures.Contains(c.SubFeatureCode))
                 || c.EventType == "call_click" || c.EventType == "email_click"))
            .GroupBy(c => c.TargetId!)
            .Select(g => new { CustomerId = long.Parse(g.Key), Count = g.Count() })
            .OrderByDescending(g => g.Count)
            .FirstOrDefault();

        TopProducerDto? topProducer = null;
        if (topProducerGroup != null)
        {
            var snap = await _appDb.Customers
                .Where(c => c.Id == topProducerGroup.CustomerId)
                .Select(c => new { CustomerName = c.Name, c.ScoularId })
                .FirstOrDefaultAsync(ct);
            if (snap != null)
            {
                topProducer = new TopProducerDto
                {
                    CustomerId = topProducerGroup.CustomerId,
                    CustomerName = snap.CustomerName,
                    ScoularId = snap.ScoularId,
                    InteractionCount = topProducerGroup.Count,
                };
            }
        }

        // ── Customer Page counters ──
        var customers = new CustomerEngagementDto
        {
            // Distinct by TargetId — reopening the same producer doesn't recount
            ProfilesViewed = clicks
                .Where(c => c.FeatureCode == "customers" && c.SubFeatureCode == "profile-opened" && c.EventType == "interaction")
                .Select(c => c.TargetId).Distinct().Count(),
            ContractsExpanded = clicks
                .Where(c => c.FeatureCode == "customers" && c.SubFeatureCode == "contracts" && c.EventType == "interaction")
                .Select(c => c.TargetId).Distinct().Count(),
            CallsClicked = clicks.Count(c => c.EventType == "call_click"),
            EmailsClicked = clicks.Count(c => c.EventType == "email_click"),
            NotesCreated = activities.Count(a => a.SubFeatureCode == "notes-create" && a.HttpMethod == "POST"),
            PlantingIntentionsAdded = activities.Count(a => a.SubFeatureCode == "planting-intentions" && a.HttpMethod == "POST"),
            ProducerDetailsEdited = clicks.Count(c => c.FeatureCode == "customers" && c.SubFeatureCode == "producer-details" && c.EventType == "interaction"),
            TicketDropdownOpens = clicks.Count(c => c.FeatureCode == "customers" && c.SubFeatureCode == "tickets" && c.EventType == "interaction"),
            StorageDropdownOpens = clicks.Count(c => c.FeatureCode == "customers" && c.SubFeatureCode == "storage" && c.EventType == "interaction"),
            PlantingTabClicks = clicks.Count(c => c.FeatureCode == "customers" && c.SubFeatureCode == "planting-intentions" && c.EventType == "interaction"),
            TopProducer = topProducer,
        };

        // ── Build a List counters + top library queries ──
        var topQueryCounts = clicks
            .Where(c => c.FeatureCode == "build-a-list" && c.SubFeatureCode == "library-query-selected" && c.TargetId != null)
            .GroupBy(c => c.TargetId!)
            .Select(g => new { QueryId = g.Key, Count = g.Count() })
            .OrderByDescending(g => g.Count)
            .Take(5)
            .ToList();

        var topQueryIds = topQueryCounts
            .Select(q => int.TryParse(q.QueryId, out var id) ? id : 0)
            .Where(id => id > 0)
            .ToList();
        var topQueryNames = topQueryIds.Count > 0
            ? await _appDb.QueryLibrary
                .Where(q => topQueryIds.Contains(q.Id))
                .ToDictionaryAsync(q => q.Id.ToString(), q => q.Name, ct)
            : new Dictionary<string, string>();

        var buildList = new BuildListEngagementDto
        {
            ListsSaved = clicks.Count(c => c.FeatureCode == "build-a-list" && c.SubFeatureCode == "save-list"),
            ListsLoaded = clicks.Count(c => c.FeatureCode == "build-a-list" && c.SubFeatureCode == "saved-list-loaded"),
            ListsDeleted = clicks.Count(c => c.FeatureCode == "build-a-list" && c.SubFeatureCode == "saved-list-deleted"),
            LibraryPromptsClicked = clicks.Count(c => c.FeatureCode == "build-a-list" && c.SubFeatureCode == "library-query-selected"),
            LibrarySearchNoMatch = clicks.Count(c => c.FeatureCode == "build-a-list" && c.SubFeatureCode == "library-search-no-match"),
            QueryRequestsSubmitted = clicks.Count(c => c.FeatureCode == "build-a-list" && c.SubFeatureCode == "query-request-submitted"),
            MembersAdded = clicks.Count(c => c.FeatureCode == "build-a-list" && c.SubFeatureCode == "member-added"),
            MembersExcluded = clicks.Count(c => c.FeatureCode == "build-a-list" && c.SubFeatureCode == "member-excluded"),
            RefineFiltersOpens = clicks.Count(c => c.FeatureCode == "build-a-list" && c.SubFeatureCode == "refine-filters"),
            ManageMembersOpens = clicks.Count(c => c.FeatureCode == "build-a-list" && c.SubFeatureCode == "manage-members"),
            TopLibraryQueries = topQueryCounts.Select(q => new TopLibraryQueryDto
            {
                QueryName = topQueryNames.TryGetValue(q.QueryId, out var name) ? name : $"Query #{q.QueryId}",
                TimesUsed = q.Count
            }).ToList()
        };

        // ── Insights category clicks ──
        var knownInsightCats = new[] { "unconfirmed-contracts", "spot-loads", "unshipped-bushels" };
        var insights = new InsightsEngagementDto
        {
            UnconfirmedContractsClicks = clicks.Count(c => c.FeatureCode == "insights" && c.SubFeatureCode == "unconfirmed-contracts"),
            SpotLoadsClicks = clicks.Count(c => c.FeatureCode == "insights" && c.SubFeatureCode == "spot-loads"),
            UnshippedBushelsClicks = clicks.Count(c => c.FeatureCode == "insights" && c.SubFeatureCode == "unshipped-bushels"),
            OtherCategoryClicks = clicks.Count(c => c.FeatureCode == "insights"
                && c.SubFeatureCode != null
                && !knownInsightCats.Contains(c.SubFeatureCode)),
        };

        // ── Bid Sheet counters ──
        // bids-changed events carry the location name as TargetId (added in the
        // saveEditBids tracker). Group to find the most-edited location + top 5.
        var locationEditGroups = clicks
            .Where(c => c.FeatureCode == "bidsheet" && c.SubFeatureCode == "bids-changed" && !string.IsNullOrEmpty(c.TargetId))
            .GroupBy(c => c.TargetId!)
            .Select(g => new TopBidLocationDto { LocationName = g.Key, EditCount = g.Count() })
            .OrderByDescending(g => g.EditCount)
            .ToList();

        var bidSheet = new BidSheetEngagementDto
        {
            LocationsAdded = clicks.Count(c => c.FeatureCode == "bidsheet" && c.SubFeatureCode == "locations-added"),
            LocationsDeleted = clicks.Count(c => c.FeatureCode == "bidsheet" && c.SubFeatureCode == "location-deleted"),
            LocationsSelected = clicks.Count(c => c.FeatureCode == "bidsheet" && c.SubFeatureCode == "location-selected"),
            CommoditiesAdded = clicks.Count(c => c.FeatureCode == "bidsheet" && c.SubFeatureCode == "commodities-added"),
            BidsChanged = clicks.Count(c => c.FeatureCode == "bidsheet" && c.SubFeatureCode == "bids-changed"),
            EditBidsOpens = clicks.Count(c => c.FeatureCode == "bidsheet" && c.SubFeatureCode == "edit-bids-opened"),
            ReferenceSet = clicks.Count(c => c.FeatureCode == "bidsheet" && c.SubFeatureCode == "reference-set"),
            MostEditedLocation = locationEditGroups.FirstOrDefault(),
            TopEditedLocations = locationEditGroups.Take(5).ToList(),
        };

        // ── Planting Dashboard counters ──
        var plantingDash = new PlantingDashEngagementDto
        {
            ByCropTabClicks = clicks.Count(c => c.FeatureCode == "dashboard" && c.SubFeatureCode == "by-crop"),
            ProducersTabClicks = clicks.Count(c => c.FeatureCode == "dashboard" && c.SubFeatureCode == "producers-and-intentions"),
            HarvestContractsTabClicks = clicks.Count(c => c.FeatureCode == "dashboard" && c.SubFeatureCode == "harvest-contracts"),
            ProducerRowClicks = clicks.Count(c => c.FeatureCode == "dashboard" && c.SubFeatureCode == "producer-row-click"),
            SeasonTargetsSaved = clicks.Count(c => c.FeatureCode == "dashboard" && c.SubFeatureCode == "set-season-targets"),
        };

        // ── Time per screen (minutes) ──
        var featureLabels = new Dictionary<string, string>
        {
            ["customers"] = "Customer Page",
            ["dashboard"] = "Planting Intention Dashboard",
            ["build-a-list"] = "Build a List",
            ["insights"] = "Actionable Insights",
            ["bidsheet"] = "Bid Sheet",
            ["position-report"] = "Position Report",
        };
        var timePerScreen = featureLabels
            .Select(fl => new ScreenTimeDto
            {
                FeatureCode = fl.Key,
                FeatureLabel = fl.Value,
                Minutes = (int)Math.Round(timePerFeature.GetValueOrDefault(fl.Key))
            })
            .Where(s => s.Minutes > 0)
            .OrderByDescending(s => s.Minutes)
            .ToList();

        // ── Recent activity (top 50, newest first) ──
        var recentActivity = clicks
            .OrderByDescending(c => c.Timestamp)
            .Take(50)
            .Select(c => new RecentActivityDto
            {
                Timestamp = c.Timestamp,
                EventType = c.EventType,
                FeatureCode = c.FeatureCode,
                SubFeatureCode = c.SubFeatureCode,
                TargetId = c.TargetId,
                TargetName = null,
            })
            .ToList();

        // Enrich TargetIds that map to known entities so the UI shows a name instead
        // of an opaque numeric id. Two resolution paths:
        //   1. Customer ids — features that store customerId in TargetId. Resolved
        //      via dbo.Customer for the display name.
        //   2. QueryLibrary ids — featureCode='build-a-list' / sub='library-query-selected'.
        //      Resolved via dbo.QueryLibrary.
        var customerSubFeatures = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "profile-opened", "customer-details", "producer-details",
            "tickets", "storage", "planting-intentions", "contracts",
            "member-added", "member-excluded", "producer-row-click",
            // Insights subFeatures (set by selectInsight in insights.component.ts)
            "unconfirmed-contracts", "spot-loads", "unshipped-bushels",
        };

        var customerTargetIds = recentActivity
            .Where(r => r.TargetId != null
                && long.TryParse(r.TargetId, out _)
                && (
                    (r.FeatureCode == "customers" && (r.SubFeatureCode == null || customerSubFeatures.Contains(r.SubFeatureCode)))
                    || (r.FeatureCode == "insights" && r.SubFeatureCode != null && customerSubFeatures.Contains(r.SubFeatureCode))
                    || (r.FeatureCode == "dashboard" && r.SubFeatureCode == "producer-row-click")
                    || (r.FeatureCode == "build-a-list" && (r.SubFeatureCode == "member-added" || r.SubFeatureCode == "member-excluded"))
                ))
            .Select(r => long.Parse(r.TargetId!))
            .Distinct()
            .ToList();

        var customerNames = customerTargetIds.Count > 0
            ? await _appDb.Customers
                .Where(c => customerTargetIds.Contains(c.Id))
                .Select(c => new { CustomerId = c.Id, Name = c.Name, Code = c.ScoularId })
                .ToDictionaryAsync(g => g.CustomerId.ToString(), g => string.IsNullOrEmpty(g.Code) ? g.Name : $"{g.Name} ({g.Code})", ct)
            : new Dictionary<string, string>();

        var libraryTargetIds = recentActivity
            .Where(r => r.TargetId != null
                && r.FeatureCode == "build-a-list"
                && r.SubFeatureCode == "library-query-selected"
                && int.TryParse(r.TargetId, out _))
            .Select(r => int.Parse(r.TargetId!))
            .Distinct()
            .ToList();

        var libraryNames = libraryTargetIds.Count > 0
            ? await _appDb.QueryLibrary
                .Where(q => libraryTargetIds.Contains(q.Id))
                .ToDictionaryAsync(q => q.Id.ToString(), q => q.Name, ct)
            : new Dictionary<string, string>();

        // Contracts: featureCode='customers' / sub='contracts'. TargetId is the
        // long row id from base.vw_CurrentContracts. Resolve to ContractNumber +
        // commodity so the row reads "C12345 — CORN" instead of "987654".
        var contractTargetIds = recentActivity
            .Where(r => r.TargetId != null
                && r.FeatureCode == "customers"
                && r.SubFeatureCode == "contracts"
                && long.TryParse(r.TargetId, out _))
            .Select(r => long.Parse(r.TargetId!))
            .Distinct()
            .ToList();

        var contractNames = contractTargetIds.Count > 0
            ? await _odsDb.Contracts
                .Where(c => contractTargetIds.Contains(c.Id))
                .Select(c => new { c.Id, c.ContractNumber, c.CommodityCode })
                .ToDictionaryAsync(
                    c => c.Id.ToString(),
                    c => string.IsNullOrEmpty(c.CommodityCode)
                        ? c.ContractNumber
                        : $"{c.ContractNumber} — {c.CommodityCode}",
                    ct)
            : new Dictionary<string, string>();

        foreach (var row in recentActivity)
        {
            if (row.TargetId == null) continue;
            if (customerNames.TryGetValue(row.TargetId, out var custName)) { row.TargetName = custName; continue; }
            if (libraryNames.TryGetValue(row.TargetId, out var libName))   { row.TargetName = libName;  continue; }
            if (contractNames.TryGetValue(row.TargetId, out var ctName))   { row.TargetName = ctName;   continue; }
        }

        var customersContacted = clicks.Count(c => c.EventType == "call_click" || c.EventType == "email_click");

        return Ok(new UserUsageDetailDto
        {
            UserId = userId,
            DisplayName = displayName,
            Status = status,
            LastActive = lastActive,
            LoginCount = loginCount,
            AvgSessionMinutes = Math.Round(avgMinutes, 1),
            TotalAppMinutes = Math.Round(totalMinutes, 1),
            CustomersContactedCount = customersContacted,
            DailyActivity = dailyActivity,
            Customers = customers,
            BuildList = buildList,
            Insights = insights,
            BidSheet = bidSheet,
            PlantingDashboard = plantingDash,
            TimePerScreen = timePerScreen,
            RecentActivity = recentActivity
        });
    }

    // Telemetry endpoint — every signed-in user posts click events from the UI,
    // not just Admin. Intentionally left without the per-method AdminOnly policy
    // so the class-level `[Authorize]` (any authenticated user) applies.
    [HttpPost("click-event")]
    public ActionResult TrackClickEvent(
        [FromBody] ClickEventRequest request,
        [FromServices] Channel<UserClickEventRecord> clickChannel)
    {
        var rawUserId = User.FindFirst("preferred_username")?.Value
            ?? User.FindFirst("oid")?.Value
            ?? User.Identity?.Name;

        if (string.IsNullOrEmpty(rawUserId))
            return Unauthorized();

        // Normalize: strip @domain to match Entitlements view
        var userId = rawUserId.Contains('@') ? rawUserId.Split('@')[0] : rawUserId;

        clickChannel.Writer.TryWrite(new UserClickEventRecord
        {
            UserId = userId,
            EventType = request.EventType,
            FeatureCode = request.FeatureCode,
            SubFeatureCode = request.SubFeatureCode,
            TargetId = request.TargetId,
            Timestamp = DateTime.UtcNow
        });

        return Accepted();
    }

    private static string FormatSubFeatureLabel(string subFeatureCode)
    {
        return subFeatureCode.Replace('-', ' ')
            .Split(' ')
            .Select(w => w.Length > 0 ? char.ToUpper(w[0]) + w[1..] : w)
            .Aggregate((a, b) => $"{a} {b}");
    }
}
