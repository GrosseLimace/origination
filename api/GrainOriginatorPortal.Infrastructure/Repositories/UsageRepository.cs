using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class UsageRepository : IUsageRepository
{
    private readonly ApplicationDbContext _appDb;
    private readonly OriginationDbContext _odsDb;
    private readonly EntitlementsDbContext _entDb;

    public UsageRepository(ApplicationDbContext appDb, OriginationDbContext odsDb, EntitlementsDbContext entDb)
    {
        _appDb = appDb;
        _odsDb = odsDb;
        _entDb = entDb;
    }

    // ── Identity / snapshot ──

    public async Task<List<string>> GetSnapshotUserIdsAsync(IReadOnlyCollection<string>? tradeUnitCodes, CancellationToken cancellationToken)
    {
        if (tradeUnitCodes is null || tradeUnitCodes.Count == 0)
        {
            return await _appDb.UserTradeUnitSnapshots.Select(s => s.UserId).Distinct().ToListAsync(cancellationToken);
        }
        return await _appDb.UserTradeUnitSnapshots
            .Where(s => tradeUnitCodes.Contains(s.TradeUnitCode))
            .Select(s => s.UserId)
            .Distinct()
            .ToListAsync(cancellationToken);
    }

    public async Task<List<string>> GetExcludedUserIdsAsync(CancellationToken cancellationToken)
    {
        return await _appDb.UsageDashboardExcludedUsers
            .AsNoTracking()
            .Select(e => e.UserId)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<UserDisplayName>> GetDisplayNamesAsync(IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserTradeUnitSnapshots
            .Where(s => userIds.Contains(s.UserId))
            .Select(s => new { s.UserId, s.DisplayName })
            .Distinct()
            .ToListAsync(cancellationToken);
        return rows.Select(r => new UserDisplayName(r.UserId, r.DisplayName)).ToList();
    }

    // ── Activities ──

    public async Task<List<string>> GetActiveUserIdsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        return await _appDb.UserActivities
            .Where(a => a.Timestamp >= fromUtc && a.Timestamp < toUtc && userIds.Contains(a.UserId))
            .Select(a => a.UserId)
            .Distinct()
            .ToListAsync(cancellationToken);
    }

    public async Task<List<UserActivityDay>> GetActivityDayUserPairsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserActivities
            .Where(a => a.Timestamp >= fromUtc && a.Timestamp < toUtc && userIds.Contains(a.UserId))
            .Select(a => new { a.UserId, Date = a.Timestamp.Date })
            .Distinct()
            .ToListAsync(cancellationToken);
        return rows.Select(r => new UserActivityDay(r.UserId, r.Date)).ToList();
    }

    public async Task<List<UserLastActivity>> GetLastActivityByUserAsync(DateTime? fromUtc, DateTime? toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        var query = _appDb.UserActivities.Where(a => userIds.Contains(a.UserId));
        if (fromUtc.HasValue) query = query.Where(a => a.Timestamp >= fromUtc.Value);
        if (toUtc.HasValue) query = query.Where(a => a.Timestamp < toUtc.Value);

        var rows = await query
            .GroupBy(a => a.UserId)
            .Select(g => new { UserId = g.Key, LastActive = g.Max(a => a.Timestamp) })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new UserLastActivity(r.UserId, r.LastActive)).ToList();
    }

    public async Task<List<UserCount>> GetNotesCreatedCountsByUserAsync(DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserActivities
            .Where(a => a.Timestamp >= fromUtc && a.Timestamp < toUtc
                && a.SubFeatureCode == "notes-create" && a.HttpMethod == "POST")
            .GroupBy(a => a.UserId)
            .Select(g => new { UserId = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new UserCount(r.UserId, r.Count)).ToList();
    }

    public async Task<List<FeatureCount>> GetNotesCreatedCountsByFeatureAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserActivities
            .Where(a => a.Timestamp >= fromUtc && a.Timestamp < toUtc
                && a.SubFeatureCode == "notes-create" && a.HttpMethod == "POST"
                && userIds.Contains(a.UserId))
            .GroupBy(a => a.FeatureCode)
            .Select(g => new { FeatureCode = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new FeatureCount(r.FeatureCode, r.Count)).ToList();
    }

    public async Task<List<UserActivityBreakdown>> GetActivityBreakdownByUserAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserActivities
            .Where(a => a.Timestamp >= fromUtc && a.Timestamp < toUtc && userIds.Contains(a.UserId))
            .GroupBy(a => a.UserId)
            .Select(g => new
            {
                UserId = g.Key,
                NotesTaken = g.Count(a => a.SubFeatureCode == "notes-create" && a.HttpMethod == "POST"),
                PlantingIntentionsAdded = g.Count(a => a.SubFeatureCode == "planting-intentions" && a.HttpMethod == "POST")
            })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new UserActivityBreakdown(r.UserId, r.NotesTaken, r.PlantingIntentionsAdded)).ToList();
    }

    public async Task<DateTime?> GetLastActivityForUserAsync(string userId, CancellationToken cancellationToken)
    {
        return await _appDb.UserActivities
            .Where(a => a.UserId == userId)
            .OrderByDescending(a => a.Timestamp)
            .Select(a => (DateTime?)a.Timestamp)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<List<UserActivityRow>> GetActivitiesForUserAsync(string userId, DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserActivities
            .Where(a => a.UserId == userId && a.Timestamp >= fromUtc && a.Timestamp < toUtc)
            .Select(a => new { a.SubFeatureCode, a.HttpMethod })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new UserActivityRow(r.SubFeatureCode, r.HttpMethod)).ToList();
    }

    // ── Sessions ──

    public async Task<List<int>> GetSessionDurationsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        return await _appDb.UserSessions
            .Where(s => s.LoginTime >= fromUtc && s.LoginTime < toUtc && userIds.Contains(s.UserId))
            .Select(s => s.DurationMinutes)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<UserSessionStats>> GetSessionStatsByUserAsync(DateTime? fromUtc, DateTime? toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        var query = _appDb.UserSessions.Where(s => userIds.Contains(s.UserId));
        if (fromUtc.HasValue) query = query.Where(s => s.LoginTime >= fromUtc.Value);
        if (toUtc.HasValue) query = query.Where(s => s.LoginTime < toUtc.Value);

        var rows = await query
            .GroupBy(s => s.UserId)
            .Select(g => new { UserId = g.Key, LoginCount = g.Count(), AvgDuration = g.Average(s => (double)s.DurationMinutes) })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new UserSessionStats(r.UserId, r.LoginCount, r.AvgDuration)).ToList();
    }

    public async Task<List<UserLoginTime>> GetSessionLoginTimesAsync(DateTime sinceUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserSessions
            .Where(s => s.LoginTime >= sinceUtc && userIds.Contains(s.UserId))
            .Select(s => new { s.UserId, s.LoginTime })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new UserLoginTime(r.UserId, r.LoginTime)).ToList();
    }

    public async Task<List<int>> GetSessionDurationsForUserAsync(string userId, DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken)
    {
        return await _appDb.UserSessions
            .Where(s => s.UserId == userId && s.LoginTime >= fromUtc && s.LoginTime < toUtc)
            .Select(s => s.DurationMinutes)
            .ToListAsync(cancellationToken);
    }

    // ── Click events ──

    public async Task<List<UserCount>> GetContactCountsByUserAsync(DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= fromUtc && c.Timestamp < toUtc
                && (c.EventType == "call_click" || c.EventType == "email_click"))
            .GroupBy(c => c.UserId)
            .Select(g => new { UserId = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new UserCount(r.UserId, r.Count)).ToList();
    }

    public async Task<List<ScreenEnterEvent>> GetScreenEnterEventsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= fromUtc && c.Timestamp < toUtc
                && c.EventType == "screen_enter" && userIds.Contains(c.UserId))
            .Select(c => new { c.UserId, c.FeatureCode, c.Timestamp })
            .OrderBy(c => c.UserId).ThenBy(c => c.Timestamp)
            .ToListAsync(cancellationToken);
        return rows.Select(r => new ScreenEnterEvent(r.UserId, r.FeatureCode, r.Timestamp)).ToList();
    }

    public async Task<List<FeatureSubFeatureCount>> GetInteractionCountsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, string? screen, CancellationToken cancellationToken)
    {
        var query = _appDb.UserClickEvents
            .Where(c => c.Timestamp >= fromUtc && c.Timestamp < toUtc
                && c.EventType == "interaction" && userIds.Contains(c.UserId));
        if (!string.IsNullOrWhiteSpace(screen) && screen != "all")
            query = query.Where(c => c.FeatureCode == screen);

        var rows = await query
            .GroupBy(c => new { c.FeatureCode, c.SubFeatureCode })
            .Select(g => new { g.Key.FeatureCode, g.Key.SubFeatureCode, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new FeatureSubFeatureCount(r.FeatureCode, r.SubFeatureCode, r.Count)).ToList();
    }

    public async Task<List<ClickBreakdownRow>> GetClickBreakdownRowsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= fromUtc && c.Timestamp < toUtc && userIds.Contains(c.UserId))
            .Select(c => new { c.UserId, c.EventType, c.FeatureCode, c.SubFeatureCode, c.TargetId })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new ClickBreakdownRow(r.UserId, r.EventType, r.FeatureCode, r.SubFeatureCode, r.TargetId)).ToList();
    }

    public async Task<List<UserClickRow>> GetClicksForUserAsync(string userId, DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserClickEvents
            .Where(c => c.UserId == userId && c.Timestamp >= fromUtc && c.Timestamp < toUtc)
            .Select(c => new { c.EventType, c.FeatureCode, c.SubFeatureCode, c.TargetId, c.Timestamp })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new UserClickRow(r.EventType, r.FeatureCode, r.SubFeatureCode, r.TargetId, r.Timestamp)).ToList();
    }

    public async Task<List<TargetCount>> GetLibraryQueryUsageAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= fromUtc && c.Timestamp < toUtc
                && c.EventType == "interaction"
                && c.FeatureCode == "build-a-list"
                && c.SubFeatureCode == "library-query-selected"
                && c.TargetId != null
                && userIds.Contains(c.UserId))
            .GroupBy(c => c.TargetId!)
            .Select(g => new { QueryId = g.Key, TimesUsed = g.Count() })
            .OrderByDescending(q => q.TimesUsed)
            .ToListAsync(cancellationToken);
        return rows.Select(r => new TargetCount(r.QueryId, r.TimesUsed)).ToList();
    }

    public async Task<List<QuerySearchGapRow>> GetQuerySearchGapsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= fromUtc && c.Timestamp < toUtc
                && c.EventType == "interaction"
                && c.FeatureCode == "build-a-list"
                && c.SubFeatureCode == "library-search-no-match"
                && c.TargetId != null
                && userIds.Contains(c.UserId))
            .GroupBy(c => c.TargetId!)
            .Select(g => new { SearchText = g.Key, TimesSearched = g.Count() })
            .OrderByDescending(q => q.TimesSearched)
            .Take(20)
            .ToListAsync(cancellationToken);
        return rows.Select(r => new QuerySearchGapRow(r.SearchText, r.TimesSearched)).ToList();
    }

    // ── Daily aggregates ──

    public async Task<List<FeatureCount>> GetFeatureSessionTotalsAsync(DateOnly fromDate, DateOnly toDate, CancellationToken cancellationToken)
    {
        var rows = await _appDb.FeatureUsageDailies
            .Where(f => f.ActivityDate >= fromDate && f.ActivityDate < toDate && f.SubFeatureCode == "__total__")
            .GroupBy(f => f.FeatureCode)
            .Select(g => new { FeatureCode = g.Key, SessionCount = g.Sum(f => f.SessionCount) })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new FeatureCount(r.FeatureCode, r.SessionCount)).ToList();
    }

    // ── Name lookups ──

    public async Task<Dictionary<string, string>> GetQueryLibraryNamesAsync(IReadOnlyCollection<int> ids, CancellationToken cancellationToken)
    {
        if (ids.Count == 0) return new Dictionary<string, string>();
        return await _appDb.QueryLibrary
            .Where(q => ids.Contains(q.Id))
            .ToDictionaryAsync(q => q.Id.ToString(), q => q.Name, cancellationToken);
    }

    public async Task<CustomerNameSnapshot?> GetCustomerNameAsync(long customerId, CancellationToken cancellationToken)
    {
        var snap = await _appDb.Customers
            .Where(c => c.Id == customerId)
            .Select(c => new { c.Name, c.ScoularId })
            .FirstOrDefaultAsync(cancellationToken);
        return snap is null ? null : new CustomerNameSnapshot(customerId, snap.Name, snap.ScoularId);
    }

    public async Task<Dictionary<string, string>> GetCustomerDisplayNamesAsync(IReadOnlyCollection<long> ids, CancellationToken cancellationToken)
    {
        if (ids.Count == 0) return new Dictionary<string, string>();
        return await _appDb.Customers
            .Where(c => ids.Contains(c.Id))
            .Select(c => new { CustomerId = c.Id, c.Name, Code = c.ScoularId })
            .ToDictionaryAsync(g => g.CustomerId.ToString(), g => string.IsNullOrEmpty(g.Code) ? g.Name : $"{g.Name} ({g.Code})", cancellationToken);
    }

    public async Task<Dictionary<string, string>> GetContractDisplayNamesAsync(IReadOnlyCollection<long> ids, CancellationToken cancellationToken)
    {
        if (ids.Count == 0) return new Dictionary<string, string>();
        return await _odsDb.Contracts
            .Where(c => ids.Contains(c.Id))
            .Select(c => new { c.Id, c.ContractNumber, c.CommodityCode })
            .ToDictionaryAsync(
                c => c.Id.ToString(),
                c => string.IsNullOrEmpty(c.CommodityCode) ? c.ContractNumber : $"{c.ContractNumber} — {c.CommodityCode}",
                cancellationToken);
    }

    // ── Writes (usage-tracking background service) ──

    public async Task AddActivitiesAndClicksAsync(IReadOnlyList<UserActivity> activities, IReadOnlyList<UserClickEvent> clicks, CancellationToken cancellationToken)
    {
        if (activities.Count > 0) _appDb.UserActivities.AddRange(activities);
        if (clicks.Count > 0) _appDb.UserClickEvents.AddRange(clicks);
        await _appDb.SaveChangesAsync(cancellationToken);
    }

    public async Task ApplyActivitySessionsAsync(IReadOnlyList<UserActivity> activities, TimeSpan sessionGap, CancellationToken cancellationToken)
    {
        var userLatest = activities
            .GroupBy(r => r.UserId, StringComparer.OrdinalIgnoreCase)
            .Select(g => new { UserId = g.Key, LatestTimestamp = g.Max(r => r.Timestamp) })
            .ToList();
        if (userLatest.Count == 0) return;

        var userIds = userLatest.Select(x => x.UserId).ToList();
        // Anyone whose most recent activity sits beyond this cutoff must start a new session.
        var cutoff = userLatest.Min(x => x.LatestTimestamp) - sessionGap;

        // Fetch candidate open sessions for these users in one query, then pick latest per user in memory
        // (avoids the GroupBy+First LINQ translation pitfalls that caused the old seed query to fail).
        var candidates = await _appDb.UserSessions
            .Where(s => userIds.Contains(s.UserId) && s.LastActivityTime >= cutoff)
            .ToListAsync(cancellationToken);

        var latestOpenByUser = candidates
            .GroupBy(s => s.UserId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => g.OrderByDescending(s => s.LastActivityTime).First(),
                StringComparer.OrdinalIgnoreCase);

        foreach (var entry in userLatest)
        {
            if (latestOpenByUser.TryGetValue(entry.UserId, out var openSession)
                && (entry.LatestTimestamp - openSession.LastActivityTime) < sessionGap)
            {
                // Extend the existing session — only update if the new timestamp is newer.
                if (entry.LatestTimestamp > openSession.LastActivityTime)
                    openSession.LastActivityTime = entry.LatestTimestamp;
            }
            else
            {
                _appDb.UserSessions.Add(new UserSession
                {
                    UserId = entry.UserId,
                    LoginTime = entry.LatestTimestamp,
                    LastActivityTime = entry.LatestTimestamp
                });
            }
        }

        await _appDb.SaveChangesAsync(cancellationToken);
    }

    // ── Aggregation jobs (usage-aggregation background service) ──

    public async Task AggregateUserActivityDailyAsync(DateOnly date, CancellationToken cancellationToken)
    {
        var dayStart = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var dayEnd = dayStart.AddDays(1);

        var userActivities = await _appDb.UserActivities
            .Where(a => a.Timestamp >= dayStart && a.Timestamp < dayEnd)
            .GroupBy(a => a.UserId)
            .Select(g => new
            {
                UserId = g.Key,
                RequestCount = g.Count(),
                CustomersViewed = g.Count(a => a.SubFeatureCode == "customer-details"),
                ContractsViewed = g.Count(a => a.SubFeatureCode == "contracts"),
                NotesCreated = g.Count(a => a.SubFeatureCode == "notes-create"),
                ListsBuilt = g.Count(a => a.FeatureCode == "build-a-list" && a.SubFeatureCode == "save-list"),
                PlantingIntentionsAdded = g.Count(a => a.SubFeatureCode == "planting-intentions" && a.HttpMethod == "POST"),
                ProducerDetailsViewed = g.Count(a => a.SubFeatureCode == "producer-details"),
            })
            .ToListAsync(cancellationToken);

        var userSessions = await _appDb.UserSessions
            .Where(s => s.LoginTime >= dayStart && s.LoginTime < dayEnd)
            .GroupBy(s => s.UserId)
            .Select(g => new { UserId = g.Key, SessionCount = g.Count(), TotalSessionMinutes = g.Sum(s => s.DurationMinutes) })
            .ToListAsync(cancellationToken);
        var sessionLookup = userSessions.ToDictionary(s => s.UserId, StringComparer.OrdinalIgnoreCase);

        var userClicks = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= dayStart && c.Timestamp < dayEnd)
            .GroupBy(c => c.UserId)
            .Select(g => new { UserId = g.Key, CallClicks = g.Count(c => c.EventType == "call_click"), EmailClicks = g.Count(c => c.EventType == "email_click") })
            .ToListAsync(cancellationToken);
        var clickLookup = userClicks.ToDictionary(c => c.UserId, StringComparer.OrdinalIgnoreCase);

        foreach (var ua in userActivities)
        {
            sessionLookup.TryGetValue(ua.UserId, out var sessions);
            clickLookup.TryGetValue(ua.UserId, out var clicks);

            var existing = await _appDb.UserActivityDailies
                .FirstOrDefaultAsync(d => d.UserId == ua.UserId && d.ActivityDate == date, cancellationToken);

            if (existing != null)
            {
                existing.RequestCount = ua.RequestCount;
                existing.SessionCount = sessions?.SessionCount ?? 0;
                existing.TotalSessionMinutes = sessions?.TotalSessionMinutes ?? 0;
                existing.CustomersViewed = ua.CustomersViewed;
                existing.ContractsViewed = ua.ContractsViewed;
                existing.NotesCreated = ua.NotesCreated;
                existing.ListsBuilt = ua.ListsBuilt;
                existing.PlantingIntentionsAdded = ua.PlantingIntentionsAdded;
                existing.ProducerDetailsViewed = ua.ProducerDetailsViewed;
                existing.CallClicks = clicks?.CallClicks ?? 0;
                existing.EmailClicks = clicks?.EmailClicks ?? 0;
            }
            else
            {
                _appDb.UserActivityDailies.Add(new UserActivityDaily
                {
                    UserId = ua.UserId,
                    ActivityDate = date,
                    RequestCount = ua.RequestCount,
                    SessionCount = sessions?.SessionCount ?? 0,
                    TotalSessionMinutes = sessions?.TotalSessionMinutes ?? 0,
                    CustomersViewed = ua.CustomersViewed,
                    ContractsViewed = ua.ContractsViewed,
                    NotesCreated = ua.NotesCreated,
                    ListsBuilt = ua.ListsBuilt,
                    PlantingIntentionsAdded = ua.PlantingIntentionsAdded,
                    ProducerDetailsViewed = ua.ProducerDetailsViewed,
                    CallClicks = clicks?.CallClicks ?? 0,
                    EmailClicks = clicks?.EmailClicks ?? 0
                });
            }
        }

        await _appDb.SaveChangesAsync(cancellationToken);
    }

    public async Task AggregateFeatureUsageDailyAsync(DateOnly date, CancellationToken cancellationToken)
    {
        var dayStart = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var dayEnd = dayStart.AddDays(1);

        var featureGroups = await _appDb.UserActivities
            .Where(a => a.Timestamp >= dayStart && a.Timestamp < dayEnd)
            .GroupBy(a => new { a.FeatureCode, SubFeatureCode = a.SubFeatureCode ?? "__total__" })
            .Select(g => new { g.Key.FeatureCode, g.Key.SubFeatureCode, RequestCount = g.Count(), UniqueUsers = g.Select(a => a.UserId).Distinct().Count() })
            .ToListAsync(cancellationToken);

        var clickGroups = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= dayStart && c.Timestamp < dayEnd)
            .GroupBy(c => new { c.FeatureCode, SubFeatureCode = c.SubFeatureCode ?? "__total__" })
            .Select(g => new { g.Key.FeatureCode, g.Key.SubFeatureCode, ClickCount = g.Count() })
            .ToListAsync(cancellationToken);
        var clickLookup = clickGroups.ToDictionary(c => (c.FeatureCode, c.SubFeatureCode), c => c.ClickCount);

        foreach (var fg in featureGroups)
        {
            clickLookup.TryGetValue((fg.FeatureCode, fg.SubFeatureCode), out var clickCount);

            var existing = await _appDb.FeatureUsageDailies
                .FirstOrDefaultAsync(f => f.ActivityDate == date
                    && f.FeatureCode == fg.FeatureCode
                    && f.SubFeatureCode == fg.SubFeatureCode, cancellationToken);

            if (existing != null)
            {
                existing.RequestCount = fg.RequestCount;
                existing.UniqueUsers = fg.UniqueUsers;
                existing.ClickCount = clickCount;
                existing.SessionCount = fg.UniqueUsers; // approximate: unique users as proxy for sessions
            }
            else
            {
                _appDb.FeatureUsageDailies.Add(new FeatureUsageDaily
                {
                    ActivityDate = date,
                    FeatureCode = fg.FeatureCode,
                    SubFeatureCode = fg.SubFeatureCode,
                    RequestCount = fg.RequestCount,
                    UniqueUsers = fg.UniqueUsers,
                    SessionCount = fg.UniqueUsers,
                    ClickCount = clickCount
                });
            }
        }

        await _appDb.SaveChangesAsync(cancellationToken);
    }

    public async Task AggregateWeeklyLoginsAsync(DateOnly weekStart, CancellationToken cancellationToken)
    {
        var weekEnd = weekStart.AddDays(7);

        var weeklyData = await _appDb.UserActivityDailies
            .Where(d => d.ActivityDate >= weekStart && d.ActivityDate < weekEnd)
            .GroupBy(d => d.UserId)
            .Select(g => new
            {
                UserId = g.Key,
                LoginCount = g.Sum(d => d.SessionCount),
                SessionCount = g.Sum(d => d.SessionCount),
                TotalSessionMin = g.Sum(d => d.TotalSessionMinutes)
            })
            .ToListAsync(cancellationToken);

        foreach (var wd in weeklyData)
        {
            var existing = await _appDb.WeeklyLoginAggregates
                .FirstOrDefaultAsync(w => w.WeekStartDate == weekStart && w.UserId == wd.UserId, cancellationToken);

            if (existing != null)
            {
                existing.LoginCount = wd.LoginCount;
                existing.SessionCount = wd.SessionCount;
                existing.TotalSessionMin = wd.TotalSessionMin;
            }
            else
            {
                _appDb.WeeklyLoginAggregates.Add(new WeeklyLoginAggregate
                {
                    WeekStartDate = weekStart,
                    UserId = wd.UserId,
                    LoginCount = wd.LoginCount,
                    SessionCount = wd.SessionCount,
                    TotalSessionMin = wd.TotalSessionMin
                });
            }
        }

        await _appDb.SaveChangesAsync(cancellationToken);
    }

    public async Task<(int Unique, int Raw)> RefreshTradeUnitSnapshotAsync(CancellationToken cancellationToken)
    {
        // Load current entitlements and deduplicate by (UserId, TradeUnitCode)
        var entitlements = await _entDb.UserTradeUnitAccess.ToListAsync(cancellationToken);
        var deduped = entitlements
            .GroupBy(e => $"{e.UserId}|{e.TradeUnitCode}".ToUpperInvariant())
            .Select(g => g.First())
            .ToList();

        // Raw DELETE, then chunked inserts clearing the tracker between chunks to avoid conflicts.
        await _appDb.Database.ExecuteSqlRawAsync("DELETE FROM dbo.UserTradeUnitSnapshot", cancellationToken);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        foreach (var batch in deduped.Chunk(200))
        {
            foreach (var e in batch)
            {
                _appDb.UserTradeUnitSnapshots.Add(new UserTradeUnitSnapshot
                {
                    UserId = e.UserId,
                    DisplayName = e.DisplayName,
                    TradeUnitCode = e.TradeUnitCode,
                    GroupName = e.GroupName,
                    SnapshotDate = today
                });
            }
            await _appDb.SaveChangesAsync(cancellationToken);
            _appDb.ChangeTracker.Clear();
        }

        return (deduped.Count, entitlements.Count);
    }

    public async Task<(int Activities, int Clicks)> CleanupUsageRetentionAsync(int retentionDays, CancellationToken cancellationToken)
    {
        var cutoff = DateTime.UtcNow.AddDays(-retentionDays);

        var deletedActivities = await _appDb.Database.ExecuteSqlRawAsync(
            "DELETE FROM dbo.UserActivity WHERE Timestamp < {0}", [cutoff], cancellationToken);

        var deletedClicks = await _appDb.Database.ExecuteSqlRawAsync(
            "DELETE FROM dbo.UserClickEvent WHERE Timestamp < {0}", [cutoff], cancellationToken);

        return (deletedActivities, deletedClicks);
    }
}
