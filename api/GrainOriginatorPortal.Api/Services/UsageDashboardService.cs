using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class UsageDashboardService : IUsageDashboardService
{
    private readonly IUsageRepository _repo;
    private readonly IAppAccessService _appAccess;
    // IT/dev accounts to keep OUT of usage analytics. Populated only in prod (via
    // UsageDashboard:ExcludeUsers) — empty in dev/QA, so a no-op there. These users still have app
    // access everywhere else; this exclusion is usage-dashboard-only. Keyed by short name (UPN
    // before the '@'), case-insensitive to match the rest of the dashboard's user keys.
    private readonly HashSet<string> _excludedUsers;

    public UsageDashboardService(IUsageRepository repo, IAppAccessService appAccess, IConfiguration config)
    {
        _repo = repo;
        _appAccess = appAccess;
        _excludedUsers = new HashSet<string>(
            config.GetSection("UsageDashboard:ExcludeUsers").Get<string[]>() ?? [],
            StringComparer.OrdinalIgnoreCase);
    }

    private static readonly Dictionary<string, string> FeatureLabels = new()
    {
        ["customers"] = "Customer Page",
        ["dashboard"] = "Planting Intention Dashboard",
        ["build-a-list"] = "Build a List",
        ["insights"] = "Actionable Insights",
        ["bidsheet"] = "Bid Sheet",
        ["position-report"] = "Position Report",
    };

    /// <summary>
    /// Resolves the dashboard's user universe. When the Entra app-access set is available:
    /// "all users" (no trade-unit filter) = everyone who can actually sign in to the app, and a
    /// trade-unit filter narrows to that unit's entitled users who also have access. When the
    /// access set is unavailable (Graph blocked/misconfigured — expected in deployed envs until
    /// the IT grants land) this falls open to the pre-existing behavior: the full entitlements
    /// snapshot, so the dashboard never breaks on a Graph outage.
    /// </summary>
    private async Task<HashSet<string>> GetUserIdSetAsync(string? tradeUnitKey, CancellationToken cancellationToken)
    {
        var codes = string.IsNullOrWhiteSpace(tradeUnitKey)
            ? null
            : tradeUnitKey.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var access = await _appAccess.GetAccessSetAsync(cancellationToken);

        HashSet<string> set;
        if (codes is null && access.Available)
        {
            // "All users" = the access group itself — includes people with access but no
            // entitlements row (they'd be invisible to the snapshot), excludes entitled
            // people who can't sign in.
            set = new HashSet<string>(access.ShortNames, StringComparer.OrdinalIgnoreCase);
        }
        else
        {
            var ids = await _repo.GetSnapshotUserIdsAsync(codes, cancellationToken);
            set = new HashSet<string>(ids, StringComparer.OrdinalIgnoreCase);
            if (access.Available)
                set.IntersectWith(access.ShortNames);
        }

        // Drop configured IT/dev accounts (prod only — empty elsewhere) from every dashboard view.
        if (_excludedUsers.Count > 0)
            set.ExceptWith(_excludedUsers);
        return set;
    }

    private async Task<Dictionary<string, string>> GetDisplayNameDictAsync(HashSet<string> userIds, CancellationToken cancellationToken)
    {
        var rows = await _repo.GetDisplayNamesAsync(userIds, cancellationToken);
        return rows
            .GroupBy(s => s.UserId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().DisplayName ?? string.Empty, StringComparer.OrdinalIgnoreCase);
    }

    /// <inheritdoc />
    public async Task<UsageDashboardSummaryDto> GetSummaryAsync(DateTime from, DateTime to, string? tradeUnitKey, CancellationToken cancellationToken)
    {
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime().Date.AddDays(1);
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);
        var totalUsers = userIds.Count;

        var activeUserIds = await _repo.GetActiveUserIdsAsync(fromUtc, toUtc, userIds, cancellationToken);
        var activeUsers = activeUserIds.Count;

        var adoptionRate = totalUsers > 0 ? Math.Round((double)activeUsers / totalUsers * 100, 1) : 0;

        var durations = await _repo.GetSessionDurationsAsync(fromUtc, toUtc, userIds, cancellationToken);
        var totalWeeks = Math.Max(1, (toUtc - fromUtc).TotalDays / 7.0);
        var avgLoginsPerWeek = durations.Count > 0 ? Math.Round(durations.Count / totalWeeks, 1) : 0;
        var avgSessionMinutes = durations.Count > 0 ? Math.Round(durations.Average(), 1) : 0;

        return new UsageDashboardSummaryDto
        {
            AdoptionRate = adoptionRate,
            AvgLoginsPerWeek = avgLoginsPerWeek,
            AvgSessionMinutes = avgSessionMinutes,
            TotalUsers = totalUsers,
            ActiveUsers = activeUsers,
            NeedsAttentionCount = totalUsers - activeUsers
        };
    }

    /// <inheritdoc />
    public async Task<List<UsageDashboardUserDto>> GetUsersAsync(DateTime from, DateTime to, string? tradeUnitKey, string? status, CancellationToken cancellationToken)
    {
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime().Date.AddDays(1);
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);
        var displayNames = await GetDisplayNameDictAsync(userIds, cancellationToken);
        // Entra display names fill in for access-group members with no entitlements snapshot row
        // (e.g. admin accounts) — cached, so this is a dictionary lookup, not a Graph call.
        var accessNames = (await _appAccess.GetAccessSetAsync(cancellationToken)).DisplayNames;

        var activityLookup = (await _repo.GetLastActivityByUserAsync(fromUtc, toUtc, userIds, cancellationToken))
            .ToDictionary(a => a.UserId, StringComparer.OrdinalIgnoreCase);
        var sessionLookup = (await _repo.GetSessionStatsByUserAsync(fromUtc, toUtc, userIds, cancellationToken))
            .ToDictionary(s => s.UserId, StringComparer.OrdinalIgnoreCase);
        // Customers contacted + notes created: date-filtered, NOT trade-unit filtered (matches prior behavior).
        var clicksLookup = (await _repo.GetContactCountsByUserAsync(fromUtc, toUtc, cancellationToken))
            .ToDictionary(c => c.UserId, StringComparer.OrdinalIgnoreCase);
        var notesLookup = (await _repo.GetNotesCreatedCountsByUserAsync(fromUtc, toUtc, cancellationToken))
            .ToDictionary(n => n.UserId, n => n.Count, StringComparer.OrdinalIgnoreCase);

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
                DisplayName = displayNames.GetValueOrDefault(userId)
                    ?? accessNames.GetValueOrDefault(userId)
                    ?? userId,
                LoginCount = hasSession ? session!.LoginCount : 0,
                LastActive = hasActivity ? activity!.LastActive : null,
                AvgSessionMinutes = hasSession ? Math.Round(session!.AvgDuration, 1) : 0,
                Status = userStatus,
                CustomersContacted = clicks?.Count ?? 0,
                NotesCreated = noteCount
            });
        }

        return result.OrderByDescending(u => u.LastActive ?? DateTime.MinValue).ToList();
    }

    /// <inheritdoc />
    public async Task<List<DailyActiveDto>> GetDailyActiveAsync(DateTime from, DateTime to, string? tradeUnitKey, CancellationToken cancellationToken)
    {
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime().Date.AddDays(1);
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);

        var activities = await _repo.GetActivityDayUserPairsAsync(fromUtc, toUtc, userIds, cancellationToken);

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

        return result;
    }

    /// <inheritdoc />
    public async Task<List<FeatureSessionsDto>> GetFeatureSessionsAsync(DateTime from, DateTime to, string? tradeUnitKey, string? screen, CancellationToken cancellationToken)
    {
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime().Date.AddDays(1);
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);

        // TIME SPENT per screen — from explicit screen_enter events (time on screen N = enter N+1 − enter N, capped 30 min).
        var screenEnterEvents = await _repo.GetScreenEnterEventsAsync(fromUtc, toUtc, userIds, cancellationToken);

        var timePerFeature = new Dictionary<string, double>();
        foreach (var userGroup in screenEnterEvents.GroupBy(e => e.UserId))
        {
            var events = userGroup.OrderBy(e => e.Timestamp).ToList();
            for (int i = 0; i < events.Count - 1; i++)
            {
                var timeOnScreen = (events[i + 1].Timestamp - events[i].Timestamp).TotalMinutes;
                if (timeOnScreen > 0 && timeOnScreen <= 30)
                {
                    timePerFeature[events[i].FeatureCode] = timePerFeature.GetValueOrDefault(events[i].FeatureCode) + timeOnScreen;
                }
            }
            if (events.Count > 0)
            {
                timePerFeature[events[^1].FeatureCode] = timePerFeature.GetValueOrDefault(events[^1].FeatureCode) + 1;
            }
        }

        // SUB-FEATURE COUNTS from explicit interaction click events.
        var clickCounts = (await _repo.GetInteractionCountsAsync(fromUtc, toUtc, userIds, screen, cancellationToken))
            .Select(c => new { c.FeatureCode, SubFeatureCode = c.SubFeatureCode ?? "__total__", c.Count })
            .ToList();

        // Also count notes-create from UserActivity (POST /api/notes) — tracked via middleware.
        var notesCreateCounts = await _repo.GetNotesCreatedCountsByFeatureAsync(fromUtc, toUtc, userIds, cancellationToken);

        if (string.IsNullOrWhiteSpace(screen) || screen == "all")
        {
            return FeatureLabels.Select(fl => new FeatureSessionsDto
            {
                FeatureCode = fl.Key,
                FeatureLabel = fl.Value,
                SessionCount = (int)Math.Round(timePerFeature.GetValueOrDefault(fl.Key)),
                SubFeatures = []
            })
            .Where(f => f.SessionCount > 0)
            .OrderByDescending(f => f.SessionCount)
            .ToList();
        }
        else
        {
            var subFeatures = clickCounts
                .Where(c => c.FeatureCode == screen && c.SubFeatureCode != "__total__")
                .Select(c => new SubFeatureSessionDto
                {
                    SubFeatureCode = c.SubFeatureCode,
                    Label = FormatSubFeatureLabel(c.SubFeatureCode),
                    SessionCount = c.Count
                })
                .ToList();

            var notesCount = notesCreateCounts.FirstOrDefault(n => n.FeatureCode == screen)?.Count ?? 0;
            if (notesCount > 0)
            {
                var existing = subFeatures.FirstOrDefault(sf => sf.SubFeatureCode == "notes-create");
                if (existing != null) existing.SessionCount += notesCount;
                else subFeatures.Add(new SubFeatureSessionDto { SubFeatureCode = "notes-create", Label = "Notes Created", SessionCount = notesCount });
            }

            var totalTime = (int)Math.Round(timePerFeature.GetValueOrDefault(screen));

            return new List<FeatureSessionsDto>
            {
                new()
                {
                    FeatureCode = screen,
                    FeatureLabel = FeatureLabels.GetValueOrDefault(screen, screen),
                    SessionCount = totalTime,
                    SubFeatures = subFeatures.OrderByDescending(sf => sf.SessionCount).ToList()
                }
            };
        }
    }

    /// <inheritdoc />
    public async Task<List<WeeklyTrendDto>> GetWeeklyTrendAsync(string? tradeUnitKey, CancellationToken cancellationToken)
    {
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);
        var eightWeeksAgo = DateTime.UtcNow.AddDays(-56);

        var sessions = await _repo.GetSessionLoginTimesAsync(eightWeeksAgo, userIds, cancellationToken);

        return sessions
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
    }

    /// <inheritdoc />
    public async Task<List<ActivityBreakdownDto>> GetActivityBreakdownAsync(DateTime from, DateTime to, string? tradeUnitKey, CancellationToken cancellationToken)
    {
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime().Date.AddDays(1);
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);
        var displayNames = await GetDisplayNameDictAsync(userIds, cancellationToken);

        var activityMap = (await _repo.GetActivityBreakdownByUserAsync(fromUtc, toUtc, userIds, cancellationToken))
            .ToDictionary(a => a.UserId, StringComparer.OrdinalIgnoreCase);

        // Interaction-style counts come from the explicit click events. Distinct-by-TargetId for
        // profiles/contracts (clicking the same customer 5 times = 1 viewed, not 5).
        var rawClicks = await _repo.GetClickBreakdownRowsAsync(fromUtc, toUtc, userIds, cancellationToken);

        var clicksMap = rawClicks.GroupBy(c => c.UserId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => new
            {
                ProfilesViewed = g.Where(c => c.FeatureCode == "customers" && c.SubFeatureCode == "profile-opened" && c.EventType == "interaction").Select(c => c.TargetId).Distinct().Count(),
                ContractsViewed = g.Where(c => c.FeatureCode == "customers" && c.SubFeatureCode == "contracts" && c.EventType == "interaction").Select(c => c.TargetId).Distinct().Count(),
                CallsEmails = g.Count(c => c.EventType == "call_click" || c.EventType == "email_click"),
                ListsBuilt = g.Count(c => c.FeatureCode == "build-a-list" && c.SubFeatureCode == "save-list"),
                ProducerDetails = g.Count(c => c.FeatureCode == "customers" && c.SubFeatureCode == "producer-details" && c.EventType == "interaction")
            }, StringComparer.OrdinalIgnoreCase);

        var allUserIds = activityMap.Keys.Union(clicksMap.Keys, StringComparer.OrdinalIgnoreCase).ToList();

        return allUserIds.Select(id =>
        {
            activityMap.TryGetValue(id, out var a);
            clicksMap.TryGetValue(id, out var c);
            return new ActivityBreakdownDto
            {
                UserId = id,
                DisplayName = displayNames.GetValueOrDefault(id, id),
                ProfilesViewed = c?.ProfilesViewed ?? 0,
                ContractsViewed = c?.ContractsViewed ?? 0,
                NotesTaken = a?.NotesTaken ?? 0,
                CallsEmails = c?.CallsEmails ?? 0,
                ListsBuilt = c?.ListsBuilt ?? 0,
                PlantingIntentionsAdded = a?.PlantingIntentionsAdded ?? 0,
                ProducerDetails = c?.ProducerDetails ?? 0
            };
        }).OrderByDescending(d => d.ProfilesViewed + d.ContractsViewed + d.NotesTaken + d.CallsEmails + d.ListsBuilt + d.PlantingIntentionsAdded + d.ProducerDetails).ToList();
    }

    /// <inheritdoc />
    public async Task<List<UsageDashboardInactiveUserDto>> GetInactiveUsersAsync(DateTime from, DateTime to, string? tradeUnitKey, int daysThreshold, CancellationToken cancellationToken)
    {
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);
        var displayNames = await GetDisplayNameDictAsync(userIds, cancellationToken);

        var lastActivityLookup = (await _repo.GetLastActivityByUserAsync(null, null, userIds, cancellationToken))
            .ToDictionary(a => a.UserId, StringComparer.OrdinalIgnoreCase);
        var sessionLookup = (await _repo.GetSessionStatsByUserAsync(null, null, userIds, cancellationToken))
            .ToDictionary(s => s.UserId, StringComparer.OrdinalIgnoreCase);

        var now = DateTime.UtcNow;
        var result = new List<UsageDashboardInactiveUserDto>();

        foreach (var userId in userIds)
        {
            var hasActivity = lastActivityLookup.TryGetValue(userId, out var activity);
            var daysSince = hasActivity ? (int)(now - activity!.LastActive).TotalDays : (int?)null;

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

        return result.OrderByDescending(u => u.DaysSinceLastLogin ?? int.MaxValue).ToList();
    }

    /// <inheritdoc />
    public async Task<List<UnderusedFeatureDto>> GetUnderusedFeaturesAsync(DateTime from, DateTime to, string? tradeUnitKey, CancellationToken cancellationToken)
    {
        var fromDate = DateOnly.FromDateTime(from.ToUniversalTime());
        var toDate = DateOnly.FromDateTime(to.ToUniversalTime().Date.AddDays(1));

        var featureLookup = (await _repo.GetFeatureSessionTotalsAsync(fromDate, toDate, cancellationToken))
            .ToDictionary(f => f.FeatureCode, f => f.Count, StringComparer.OrdinalIgnoreCase);

        return FeatureLabels.Select(fl => new UnderusedFeatureDto
        {
            FeatureName = fl.Value,
            SessionCount = featureLookup.GetValueOrDefault(fl.Key)
        }).OrderBy(f => f.SessionCount).ToList();
    }

    /// <inheritdoc />
    public async Task<List<QueryLibraryUsageDto>> GetQueryLibraryUsageAsync(DateTime from, DateTime to, string? tradeUnitKey, CancellationToken cancellationToken)
    {
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime().Date.AddDays(1);
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);

        var rawUsage = await _repo.GetLibraryQueryUsageAsync(fromUtc, toUtc, userIds, cancellationToken);

        var ids = rawUsage
            .Select(r => int.TryParse(r.TargetId, out var id) ? id : 0)
            .Where(id => id > 0)
            .ToList();
        var names = await _repo.GetQueryLibraryNamesAsync(ids, cancellationToken);

        return rawUsage.Select(r => new QueryLibraryUsageDto
        {
            QueryText = names.TryGetValue(r.TargetId, out var name) ? name : $"Query #{r.TargetId}",
            TimesUsed = r.Count
        }).ToList();
    }

    /// <inheritdoc />
    public async Task<List<QuerySearchGapDto>> GetQuerySearchGapsAsync(DateTime from, DateTime to, string? tradeUnitKey, CancellationToken cancellationToken)
    {
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime().Date.AddDays(1);
        var userIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);

        var gaps = await _repo.GetQuerySearchGapsAsync(fromUtc, toUtc, userIds, cancellationToken);
        return gaps.Select(g => new QuerySearchGapDto { SearchText = g.SearchText, TimesSearched = g.TimesSearched }).ToList();
    }

    /// <inheritdoc />
    public async Task<UserUsageDetailDto?> GetUserDetailAsync(string userId, DateTime from, DateTime to, string? tradeUnitKey, CancellationToken cancellationToken)
    {
        var fromUtc = from.ToUniversalTime();
        var toUtc = to.ToUniversalTime().Date.AddDays(1);

        var allowedIds = await GetUserIdSetAsync(tradeUnitKey, cancellationToken);
        if (!allowedIds.Contains(userId))
            return null;

        var displayNames = await GetDisplayNameDictAsync(new HashSet<string>(new[] { userId }, StringComparer.OrdinalIgnoreCase), cancellationToken);
        var displayName = displayNames.GetValueOrDefault(userId, userId);

        var sessionDurations = await _repo.GetSessionDurationsForUserAsync(userId, fromUtc, toUtc, cancellationToken);
        var loginCount = sessionDurations.Count;
        var totalMinutes = sessionDurations.Sum(d => (double)d);
        var avgMinutes = loginCount > 0 ? totalMinutes / loginCount : 0;

        var lastActive = await _repo.GetLastActivityForUserAsync(userId, cancellationToken);

        var sevenDaysAgo = DateTime.UtcNow.AddDays(-7);
        var status = lastActive == null ? "Never Logged In"
            : lastActive >= sevenDaysAgo ? "Active" : "Inactive";

        var clicks = await _repo.GetClicksForUserAsync(userId, fromUtc, toUtc, cancellationToken);
        var activities = await _repo.GetActivitiesForUserAsync(userId, fromUtc, toUtc, cancellationToken);

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

        // Most-interacted producer
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
            var snap = await _repo.GetCustomerNameAsync(topProducerGroup.CustomerId, cancellationToken);
            if (snap != null)
            {
                topProducer = new TopProducerDto
                {
                    CustomerId = topProducerGroup.CustomerId,
                    CustomerName = snap.Name,
                    ScoularId = snap.ScoularId,
                    InteractionCount = topProducerGroup.Count,
                };
            }
        }

        var customers = new CustomerEngagementDto
        {
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
        var topQueryNames = await _repo.GetQueryLibraryNamesAsync(topQueryIds, cancellationToken);

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

        var plantingDash = new PlantingDashEngagementDto
        {
            ByCropTabClicks = clicks.Count(c => c.FeatureCode == "dashboard" && c.SubFeatureCode == "by-crop"),
            ProducersTabClicks = clicks.Count(c => c.FeatureCode == "dashboard" && c.SubFeatureCode == "producers-and-intentions"),
            HarvestContractsTabClicks = clicks.Count(c => c.FeatureCode == "dashboard" && c.SubFeatureCode == "harvest-contracts"),
            ProducerRowClicks = clicks.Count(c => c.FeatureCode == "dashboard" && c.SubFeatureCode == "producer-row-click"),
            SeasonTargetsSaved = clicks.Count(c => c.FeatureCode == "dashboard" && c.SubFeatureCode == "set-season-targets"),
        };

        var timePerScreen = FeatureLabels
            .Select(fl => new ScreenTimeDto
            {
                FeatureCode = fl.Key,
                FeatureLabel = fl.Value,
                Minutes = (int)Math.Round(timePerFeature.GetValueOrDefault(fl.Key))
            })
            .Where(s => s.Minutes > 0)
            .OrderByDescending(s => s.Minutes)
            .ToList();

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

        var customerSubFeatures = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "profile-opened", "customer-details", "producer-details",
            "tickets", "storage", "planting-intentions", "contracts",
            "member-added", "member-excluded", "producer-row-click",
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
        var customerNames = await _repo.GetCustomerDisplayNamesAsync(customerTargetIds, cancellationToken);

        var libraryTargetIds = recentActivity
            .Where(r => r.TargetId != null
                && r.FeatureCode == "build-a-list"
                && r.SubFeatureCode == "library-query-selected"
                && int.TryParse(r.TargetId, out _))
            .Select(r => int.Parse(r.TargetId!))
            .Distinct()
            .ToList();
        var libraryNames = await _repo.GetQueryLibraryNamesAsync(libraryTargetIds, cancellationToken);

        var contractTargetIds = recentActivity
            .Where(r => r.TargetId != null
                && r.FeatureCode == "customers"
                && r.SubFeatureCode == "contracts"
                && long.TryParse(r.TargetId, out _))
            .Select(r => long.Parse(r.TargetId!))
            .Distinct()
            .ToList();
        var contractNames = await _repo.GetContractDisplayNamesAsync(contractTargetIds, cancellationToken);

        foreach (var row in recentActivity)
        {
            if (row.TargetId == null) continue;
            if (customerNames.TryGetValue(row.TargetId, out var custName)) { row.TargetName = custName; continue; }
            if (libraryNames.TryGetValue(row.TargetId, out var libName)) { row.TargetName = libName; continue; }
            if (contractNames.TryGetValue(row.TargetId, out var ctName)) { row.TargetName = ctName; continue; }
        }

        var customersContacted = clicks.Count(c => c.EventType == "call_click" || c.EventType == "email_click");

        return new UserUsageDetailDto
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
        };
    }

    private static string FormatSubFeatureLabel(string subFeatureCode)
    {
        return subFeatureCode.Replace('-', ' ')
            .Split(' ')
            .Select(w => w.Length > 0 ? char.ToUpper(w[0]) + w[1..] : w)
            .Aggregate((a, b) => $"{a} {b}");
    }
}
