using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Modules.UsageAnalytics.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.UsageAnalytics.Interfaces;
using GrainOriginatorPortal.Infrastructure.Platform.Telemetry;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Modules.UsageAnalytics.Repositories;

public class UsageRepository : IUsageRepository
{
    private const string TotalSubFeature = "__total__";

    private readonly ApplicationDbContext _appDb;
    private readonly TradeUnitPreferencesDbContext _entDb;

    public UsageRepository(ApplicationDbContext appDb, TradeUnitPreferencesDbContext entDb)
    {
        _appDb = appDb;
        _entDb = entDb;
    }

    // ── Identity / snapshot ──

    public async Task<List<string>> GetSnapshotUserIdsAsync(CancellationToken cancellationToken)
    {
        return await _appDb.UserTradeUnitSnapshots.Select(s => s.UserId).Distinct().ToListAsync(cancellationToken);
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

    public async Task<List<UserManagerRow>> GetUserManagerLookupAsync(CancellationToken cancellationToken)
    {
        return await _entDb.UserManagerLookups
            .AsNoTracking()
            .Select(u => new UserManagerRow(
                u.UserId, u.DisplayName, u.HierId, u.ManagerUserId, u.ManagerDisplayName, u.ManagerHierId))
            .ToListAsync(cancellationToken);
    }

    // ── Excluded-users administration ──

    public async Task<List<ExcludedUserRow>> GetExcludedUsersAsync(CancellationToken cancellationToken)
    {
        var rows = await _appDb.UsageDashboardExcludedUsers
            .AsNoTracking()
            .OrderBy(e => e.UserId)
            .Select(e => new { e.Id, e.UserId, e.Reason, e.CreatedBy, e.CreatedAt })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new ExcludedUserRow(r.Id, r.UserId, r.Reason, r.CreatedBy, r.CreatedAt)).ToList();
    }

    public async Task<ExcludedUserRow?> AddExcludedUserAsync(string userId, string? reason, string createdBy, CancellationToken cancellationToken)
    {
        // The unique index on UserId is the real guard; this pre-check turns the common case into a
        // clean 409 instead of a DbUpdateException. Collation is case-insensitive, so EF.Functions
        // isn't needed — a plain equality comparison matches the index's semantics.
        var exists = await _appDb.UsageDashboardExcludedUsers
            .AnyAsync(e => e.UserId == userId, cancellationToken);
        if (exists) return null;

        var entity = new UsageDashboardExcludedUser
        {
            UserId = userId,
            Reason = reason,
            CreatedBy = createdBy,
            CreatedAt = DateTime.UtcNow
        };
        _appDb.UsageDashboardExcludedUsers.Add(entity);
        await _appDb.SaveChangesAsync(cancellationToken);

        return new ExcludedUserRow(entity.Id, entity.UserId, entity.Reason, entity.CreatedBy, entity.CreatedAt);
    }

    public async Task<bool> RemoveExcludedUserAsync(int id, CancellationToken cancellationToken)
    {
        var entity = await _appDb.UsageDashboardExcludedUsers.FirstOrDefaultAsync(e => e.Id == id, cancellationToken);
        if (entity is null) return false;

        _appDb.UsageDashboardExcludedUsers.Remove(entity);
        await _appDb.SaveChangesAsync(cancellationToken);
        return true;
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

    public async Task<List<DailyCount>> GetDailyActiveCountsAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        // SELECT DISTINCT (day, user) then count per day. The distinct is what's expensive and it
        // happens in SQL; the result is bounded by days × users, so the final count is trivial.
        var pairs = await _appDb.UserActivities
            .Where(a => a.Timestamp >= fromUtc && a.Timestamp < toUtc && userIds.Contains(a.UserId))
            .Select(a => new { Date = a.Timestamp.Date, a.UserId })
            .Distinct()
            .ToListAsync(cancellationToken);

        return pairs
            .GroupBy(p => p.Date)
            .Select(g => new DailyCount(DateOnly.FromDateTime(g.Key), g.Count()))
            .ToList();
    }

    public async Task<List<UserLastActivity>> GetLastActiveByUserAsync(IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        // Raw: recent activity (incl. today), precise timestamps, but only within the short raw-retention window.
        var raw = await _appDb.UserActivities
            .Where(a => userIds.Contains(a.UserId))
            .GroupBy(a => a.UserId)
            .Select(g => new { UserId = g.Key, Last = g.Max(a => a.Timestamp) })
            .ToListAsync(cancellationToken);

        // Rollup: one row per (user, active day), retained far longer than raw — this is what lets a
        // months-ago-dormant user be told apart from a never-logged-in one.
        var rollup = await _appDb.UserActivityDailies
            .Where(d => d.RequestCount > 0 && userIds.Contains(d.UserId))
            .GroupBy(d => d.UserId)
            .Select(g => new { UserId = g.Key, LastDay = g.Max(d => d.ActivityDate) })
            .ToListAsync(cancellationToken);

        var map = new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in raw) map[r.UserId] = r.Last;
        foreach (var r in rollup)
        {
            var asDt = r.LastDay.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            if (!map.TryGetValue(r.UserId, out var cur) || asDt > cur) map[r.UserId] = asDt;
        }
        return map.Select(kv => new UserLastActivity(kv.Key, kv.Value)).ToList();
    }

    public async Task<List<UserCount>> GetNotesCreatedCountsByUserAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserActivities
            .Where(a => a.Timestamp >= fromUtc && a.Timestamp < toUtc
                && a.SubFeatureCode == "notes-create" && a.HttpMethod == "POST"
                && userIds.Contains(a.UserId))
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

    public async Task<List<UserActivityRow>> GetActivitiesForUserAsync(string userId, DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserActivities
            .Where(a => a.UserId == userId && a.Timestamp >= fromUtc && a.Timestamp < toUtc)
            .Select(a => new { a.SubFeatureCode, a.HttpMethod })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new UserActivityRow(r.SubFeatureCode, r.HttpMethod)).ToList();
    }

    // ── Sessions ──

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

    public async Task<List<UserCount>> GetContactCountsByUserAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= fromUtc && c.Timestamp < toUtc
                && (c.EventType == "call_click" || c.EventType == "email_click")
                && userIds.Contains(c.UserId))
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

    public async Task<List<UserClickBreakdown>> GetClickBreakdownByUserAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        // Two queries rather than one: the straight counts group in SQL, but the two
        // distinct-by-target metrics need COUNT(DISTINCT …) filtered per sub-feature. Rather than
        // rely on that translating, SQL does the DISTINCT (the expensive part) and returns only
        // (user, sub-feature, target) triples for those two sub-features to count in memory.
        var counts = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= fromUtc && c.Timestamp < toUtc && userIds.Contains(c.UserId))
            .GroupBy(c => c.UserId)
            .Select(g => new
            {
                UserId = g.Key,
                CallsEmails = g.Count(c => c.EventType == "call_click" || c.EventType == "email_click"),
                ListsBuilt = g.Count(c => c.FeatureCode == "build-a-list" && c.SubFeatureCode == "save-list"),
                ProducerDetails = g.Count(c => c.FeatureCode == "customers" && c.SubFeatureCode == "producer-details" && c.EventType == "interaction")
            })
            .ToListAsync(cancellationToken);

        var distinctTargets = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= fromUtc && c.Timestamp < toUtc && userIds.Contains(c.UserId)
                && c.EventType == "interaction"
                && c.FeatureCode == "customers"
                && (c.SubFeatureCode == "profile-opened" || c.SubFeatureCode == "contracts"))
            .Select(c => new { c.UserId, c.SubFeatureCode, c.TargetId })
            .Distinct()
            .ToListAsync(cancellationToken);

        var distinctLookup = distinctTargets
            .GroupBy(t => t.UserId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => (
                    Profiles: g.Count(t => t.SubFeatureCode == "profile-opened"),
                    Contracts: g.Count(t => t.SubFeatureCode == "contracts")),
                StringComparer.OrdinalIgnoreCase);

        return counts.Select(c =>
        {
            distinctLookup.TryGetValue(c.UserId, out var distinct);
            return new UserClickBreakdown(
                c.UserId,
                ProfilesViewed: distinct.Profiles,
                ContractsViewed: distinct.Contracts,
                CallsEmails: c.CallsEmails,
                ListsBuilt: c.ListsBuilt,
                ProducerDetails: c.ProducerDetails);
        }).ToList();
    }

    public async Task<List<FeatureUser>> GetFeatureUsersAsync(DateTime fromUtc, DateTime toUtc, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        var activityPairs = await _appDb.UserActivities
            .Where(a => a.Timestamp >= fromUtc && a.Timestamp < toUtc && userIds.Contains(a.UserId))
            .Select(a => new { a.FeatureCode, a.UserId })
            .Distinct()
            .ToListAsync(cancellationToken);

        var clickPairs = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= fromUtc && c.Timestamp < toUtc && userIds.Contains(c.UserId))
            .Select(c => new { c.FeatureCode, c.UserId })
            .Distinct()
            .ToListAsync(cancellationToken);

        return activityPairs.Concat(clickPairs)
            .Select(p => new FeatureUser(p.FeatureCode, p.UserId))
            .ToList();
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

    // ── Rollup reads (closed days) ──

    public async Task<List<string>> GetActiveUserIdsFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        return await _appDb.UserActivityDailies
            .Where(d => d.ActivityDate >= fromDate && d.ActivityDate < toDateExclusive
                && d.RequestCount > 0 && userIds.Contains(d.UserId))
            .Select(d => d.UserId)
            .Distinct()
            .ToListAsync(cancellationToken);
    }

    public async Task<List<DailyCount>> GetDailyActiveCountsFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        // UserActivityDaily is unique per (user, date), so a plain row count per date is the
        // distinct-user count.
        var rows = await _appDb.UserActivityDailies
            .Where(d => d.ActivityDate >= fromDate && d.ActivityDate < toDateExclusive
                && d.RequestCount > 0 && userIds.Contains(d.UserId))
            .GroupBy(d => d.ActivityDate)
            .Select(g => new { Date = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new DailyCount(r.Date, r.Count)).ToList();
    }

    public async Task<List<UserSessionStats>> GetSessionStatsFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserActivityDailies
            .Where(d => d.ActivityDate >= fromDate && d.ActivityDate < toDateExclusive && userIds.Contains(d.UserId))
            .GroupBy(d => d.UserId)
            .Select(g => new
            {
                UserId = g.Key,
                LoginCount = g.Sum(d => d.SessionCount),
                TotalMinutes = g.Sum(d => d.TotalSessionMinutes)
            })
            .ToListAsync(cancellationToken);

        // Average per session is computed here rather than in SQL so a zero-session user can't
        // divide by zero.
        return rows
            .Select(r => new UserSessionStats(
                r.UserId,
                r.LoginCount,
                r.LoginCount > 0 ? (double)r.TotalMinutes / r.LoginCount : 0))
            .ToList();
    }

    public async Task<List<FeatureScreenTime>> GetFeatureScreenTimeFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        var rows = await _appDb.UserFeatureUsageDailies
            .Where(r => r.ActivityDate >= fromDate && r.ActivityDate < toDateExclusive
                && r.SubFeatureCode == TotalSubFeature && userIds.Contains(r.UserId))
            .GroupBy(r => r.FeatureCode)
            .Select(g => new { FeatureCode = g.Key, Minutes = g.Sum(r => r.ScreenMinutes) })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new FeatureScreenTime(r.FeatureCode, r.Minutes)).ToList();
    }

    public async Task<List<FeatureSubFeatureCount>> GetInteractionCountsFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, string? screen, CancellationToken cancellationToken)
    {
        var query = _appDb.UserFeatureUsageDailies
            .Where(r => r.ActivityDate >= fromDate && r.ActivityDate < toDateExclusive
                && r.InteractionCount > 0 && userIds.Contains(r.UserId));
        if (!string.IsNullOrWhiteSpace(screen) && screen != "all")
            query = query.Where(r => r.FeatureCode == screen);

        var rows = await query
            .GroupBy(r => new { r.FeatureCode, r.SubFeatureCode })
            .Select(g => new { g.Key.FeatureCode, g.Key.SubFeatureCode, Count = g.Sum(r => r.InteractionCount) })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new FeatureSubFeatureCount(r.FeatureCode, r.SubFeatureCode, r.Count)).ToList();
    }

    public async Task<List<FeatureUser>> GetFeatureUsersFromRollupAsync(DateOnly fromDate, DateOnly toDateExclusive, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        // DISTINCT in SQL; the result is bounded by (features × users).
        var pairs = await _appDb.UserFeatureUsageDailies
            .Where(r => r.ActivityDate >= fromDate && r.ActivityDate < toDateExclusive && userIds.Contains(r.UserId))
            .Select(r => new { r.FeatureCode, r.UserId })
            .Distinct()
            .ToListAsync(cancellationToken);

        return pairs.Select(p => new FeatureUser(p.FeatureCode, p.UserId)).ToList();
    }

    public async Task<List<WeeklyRollup>> GetWeeklyLoginRollupAsync(DateOnly sinceWeekStart, IReadOnlyCollection<string> userIds, CancellationToken cancellationToken)
    {
        // WeeklyLoginAggregate is unique per (week, user), so the row count is the active-user count.
        var rows = await _appDb.WeeklyLoginAggregates
            .Where(w => w.WeekStartDate >= sinceWeekStart && w.SessionCount > 0 && userIds.Contains(w.UserId))
            .GroupBy(w => w.WeekStartDate)
            .Select(g => new { WeekStart = g.Key, ActiveUsers = g.Count(), SessionCount = g.Sum(w => w.SessionCount) })
            .ToListAsync(cancellationToken);
        return rows.Select(r => new WeeklyRollup(r.WeekStart, r.ActiveUsers, r.SessionCount)).ToList();
    }
}
