using System.Threading.Channels;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Models;

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
    private readonly ILogger<UsageDashboardController> _logger;

    public UsageDashboardController(
        ApplicationDbContext appDb,
        ILogger<UsageDashboardController> logger)
    {
        _appDb = appDb;
        _logger = logger;
    }

    /// <summary>Returns a set of UserIds filtered by trade unit codes (or all if none specified).</summary>
    private async Task<HashSet<string>> GetFilteredUserIdsAsync(string? tradeUnitKey, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(tradeUnitKey))
        {
            var all = await _appDb.UserTradeUnitSnapshots.Select(s => s.UserId).Distinct().ToListAsync(ct);
            return new HashSet<string>(all, StringComparer.OrdinalIgnoreCase);
        }

        var codes = tradeUnitKey.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
        var filtered = await _appDb.UserTradeUnitSnapshots
            .Where(s => codes.Contains(s.TradeUnitCode))
            .Select(s => s.UserId)
            .Distinct()
            .ToListAsync(ct);
        return new HashSet<string>(filtered, StringComparer.OrdinalIgnoreCase);
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
