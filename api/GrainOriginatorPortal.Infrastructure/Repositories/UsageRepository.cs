using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class UsageRepository : IUsageRepository
{
    /// <summary>Rows per DELETE statement when pruning the high-volume raw tables, so a retention
    /// backlog drains as several short transactions instead of one long log-growing one.</summary>
    private const int DeleteBatchSize = 5000;

    private const string TotalSubFeature = "__total__";

    private readonly ApplicationDbContext _appDb;
    private readonly OriginationDbContext _odsDb;
    private readonly TradeUnitPreferencesDbContext _entDb;

    public UsageRepository(ApplicationDbContext appDb, OriginationDbContext odsDb, TradeUnitPreferencesDbContext entDb)
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

        // One read for the whole day's existing rows instead of a lookup per user.
        var existingRows = (await _appDb.UserActivityDailies
                .Where(d => d.ActivityDate == date)
                .ToListAsync(cancellationToken))
            .ToDictionary(d => d.UserId, StringComparer.OrdinalIgnoreCase);

        foreach (var ua in userActivities)
        {
            sessionLookup.TryGetValue(ua.UserId, out var sessions);
            clickLookup.TryGetValue(ua.UserId, out var clicks);

            if (!existingRows.TryGetValue(ua.UserId, out var row))
            {
                row = new UserActivityDaily { UserId = ua.UserId, ActivityDate = date };
                _appDb.UserActivityDailies.Add(row);
            }

            row.RequestCount = ua.RequestCount;
            row.SessionCount = sessions?.SessionCount ?? 0;
            row.TotalSessionMinutes = sessions?.TotalSessionMinutes ?? 0;
            row.CustomersViewed = ua.CustomersViewed;
            row.ContractsViewed = ua.ContractsViewed;
            row.NotesCreated = ua.NotesCreated;
            row.ListsBuilt = ua.ListsBuilt;
            row.PlantingIntentionsAdded = ua.PlantingIntentionsAdded;
            row.ProducerDetailsViewed = ua.ProducerDetailsViewed;
            row.CallClicks = clicks?.CallClicks ?? 0;
            row.EmailClicks = clicks?.EmailClicks ?? 0;
        }

        await _appDb.SaveChangesAsync(cancellationToken);
    }

    public async Task AggregateFeatureUsageDailyAsync(DateOnly date, CancellationToken cancellationToken)
    {
        var dayStart = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var dayEnd = dayStart.AddDays(1);

        var featureGroups = await _appDb.UserActivities
            .Where(a => a.Timestamp >= dayStart && a.Timestamp < dayEnd)
            .GroupBy(a => new { a.FeatureCode, SubFeatureCode = a.SubFeatureCode ?? TotalSubFeature })
            .Select(g => new { g.Key.FeatureCode, g.Key.SubFeatureCode, RequestCount = g.Count(), UniqueUsers = g.Select(a => a.UserId).Distinct().Count() })
            .ToListAsync(cancellationToken);

        var clickGroups = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= dayStart && c.Timestamp < dayEnd)
            .GroupBy(c => new { c.FeatureCode, SubFeatureCode = c.SubFeatureCode ?? TotalSubFeature })
            .Select(g => new { g.Key.FeatureCode, g.Key.SubFeatureCode, ClickCount = g.Count() })
            .ToListAsync(cancellationToken);
        var clickLookup = clickGroups.ToDictionary(c => (c.FeatureCode, c.SubFeatureCode), c => c.ClickCount);

        var existingRows = (await _appDb.FeatureUsageDailies
                .Where(f => f.ActivityDate == date)
                .ToListAsync(cancellationToken))
            .ToDictionary(f => (f.FeatureCode, f.SubFeatureCode));

        foreach (var fg in featureGroups)
        {
            clickLookup.TryGetValue((fg.FeatureCode, fg.SubFeatureCode), out var clickCount);

            if (!existingRows.TryGetValue((fg.FeatureCode, fg.SubFeatureCode), out var row))
            {
                row = new FeatureUsageDaily
                {
                    ActivityDate = date,
                    FeatureCode = fg.FeatureCode,
                    SubFeatureCode = fg.SubFeatureCode
                };
                _appDb.FeatureUsageDailies.Add(row);
            }

            row.RequestCount = fg.RequestCount;
            row.UniqueUsers = fg.UniqueUsers;
            row.ClickCount = clickCount;
            // SessionCount used to hold UniqueUsers as a stand-in for sessions, which made a
            // "sessions" number that was really a user count. Nothing reads it now — the dashboard
            // reads UniqueUsers explicitly — so it is left at zero rather than carrying a lie.
            row.SessionCount = 0;
        }

        await _appDb.SaveChangesAsync(cancellationToken);
    }

    public async Task AggregateUserFeatureUsageDailyAsync(DateOnly date, CancellationToken cancellationToken)
    {
        var dayStart = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var dayEnd = dayStart.AddDays(1);

        var requestGroups = await _appDb.UserActivities
            .Where(a => a.Timestamp >= dayStart && a.Timestamp < dayEnd)
            .GroupBy(a => new { a.UserId, a.FeatureCode, SubFeatureCode = a.SubFeatureCode ?? TotalSubFeature })
            .Select(g => new { g.Key.UserId, g.Key.FeatureCode, g.Key.SubFeatureCode, RequestCount = g.Count() })
            .ToListAsync(cancellationToken);

        var interactionGroups = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= dayStart && c.Timestamp < dayEnd && c.EventType == "interaction")
            .GroupBy(c => new { c.UserId, c.FeatureCode, SubFeatureCode = c.SubFeatureCode ?? TotalSubFeature })
            .Select(g => new { g.Key.UserId, g.Key.FeatureCode, g.Key.SubFeatureCode, InteractionCount = g.Count() })
            .ToListAsync(cancellationToken);

        // Screen time is only meaningful at feature level, so it lands on the __total__ row.
        var screenEvents = await _appDb.UserClickEvents
            .Where(c => c.Timestamp >= dayStart && c.Timestamp < dayEnd && c.EventType == "screen_enter")
            .Select(c => new { c.UserId, c.FeatureCode, c.Timestamp })
            .ToListAsync(cancellationToken);
        var screenMinutes = ScreenTimeCalculator.MinutesByUserAndFeature(
            screenEvents.Select(e => new ScreenEnterEvent(e.UserId, e.FeatureCode, e.Timestamp)));

        var requestLookup = requestGroups.ToDictionary(
            g => (g.UserId, g.FeatureCode, g.SubFeatureCode), g => g.RequestCount);
        var interactionLookup = interactionGroups.ToDictionary(
            g => (g.UserId, g.FeatureCode, g.SubFeatureCode), g => g.InteractionCount);

        var allKeys = new HashSet<(string UserId, string FeatureCode, string SubFeatureCode)>();
        allKeys.UnionWith(requestLookup.Keys);
        allKeys.UnionWith(interactionLookup.Keys);
        // A click-only feature (e.g. the calculators, which hit no API) has no activity rows at all,
        // so its screen/interaction keys are the only thing putting it in the rollup.
        allKeys.UnionWith(screenMinutes.Keys.Select(k => (k.UserId, k.FeatureCode, TotalSubFeature)));

        var existingRows = (await _appDb.UserFeatureUsageDailies
                .Where(r => r.ActivityDate == date)
                .ToListAsync(cancellationToken))
            .ToDictionary(r => (r.UserId, r.FeatureCode, r.SubFeatureCode));

        foreach (var key in allKeys)
        {
            if (!existingRows.TryGetValue(key, out var row))
            {
                row = new UserFeatureUsageDaily
                {
                    ActivityDate = date,
                    UserId = key.UserId,
                    FeatureCode = key.FeatureCode,
                    SubFeatureCode = key.SubFeatureCode
                };
                _appDb.UserFeatureUsageDailies.Add(row);
            }

            row.RequestCount = requestLookup.GetValueOrDefault(key);
            row.InteractionCount = interactionLookup.GetValueOrDefault(key);
            row.ScreenMinutes = key.SubFeatureCode == TotalSubFeature
                ? screenMinutes.GetValueOrDefault((key.UserId, key.FeatureCode))
                : 0;
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
                ActiveDays = g.Count(d => d.RequestCount > 0),
                SessionCount = g.Sum(d => d.SessionCount),
                TotalSessionMin = g.Sum(d => d.TotalSessionMinutes)
            })
            .ToListAsync(cancellationToken);

        var existingRows = (await _appDb.WeeklyLoginAggregates
                .Where(w => w.WeekStartDate == weekStart)
                .ToListAsync(cancellationToken))
            .ToDictionary(w => w.UserId, StringComparer.OrdinalIgnoreCase);

        foreach (var wd in weeklyData)
        {
            if (!existingRows.TryGetValue(wd.UserId, out var row))
            {
                row = new WeeklyLoginAggregate { WeekStartDate = weekStart, UserId = wd.UserId };
                _appDb.WeeklyLoginAggregates.Add(row);
            }

            // LoginCount previously duplicated SessionCount exactly. It now carries the distinct
            // days the user was active that week, which is the more useful second number.
            row.LoginCount = wd.ActiveDays;
            row.SessionCount = wd.SessionCount;
            row.TotalSessionMin = wd.TotalSessionMin;
        }

        await _appDb.SaveChangesAsync(cancellationToken);
    }

    public async Task<(int Unique, int Raw)> RefreshTradeUnitSnapshotAsync(CancellationToken cancellationToken)
    {
        // Load current entitlements and deduplicate by (UserId, TradeUnitCode)
        var entitlements = await _entDb.UserTradeUnitPreferences.ToListAsync(cancellationToken);
        var deduped = entitlements
            .GroupBy(e => $"{e.UserId}|{e.TradeUnitCode}".ToUpperInvariant())
            .Select(g => g.First())
            .ToList();

        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        // Wipe-and-refill ATOMICALLY: the delete and the chunked inserts run in one transaction so a
        // mid-rebuild failure rolls back and leaves the previous snapshot intact — never empty/partial.
        // (The usage dashboard reads this table for its "all app users" universe, so a truncated snapshot
        // would silently skew that report until the next successful run.) This context has
        // EnableRetryOnFailure configured, so a user-initiated transaction must be run inside the
        // execution strategy; the delegate is idempotent (full delete + full re-insert), so a retry
        // re-runs it cleanly after resetting the change tracker.
        var strategy = _appDb.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            _appDb.ChangeTracker.Clear(); // drop anything a prior failed attempt staged
            await using var tx = await _appDb.Database.BeginTransactionAsync(cancellationToken);

            await _appDb.Database.ExecuteSqlRawAsync("DELETE FROM dbo.UserTradeUnitSnapshot", cancellationToken);

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
                _appDb.ChangeTracker.Clear(); // keep the tracker small between chunks (rows are persisted in-tx)
            }

            await tx.CommitAsync(cancellationToken);
        });

        return (deduped.Count, entitlements.Count);
    }

    public async Task<(int Activities, int Clicks)> CleanupUsageRetentionAsync(int retentionDays, CancellationToken cancellationToken)
    {
        var cutoff = DateTime.UtcNow.AddDays(-retentionDays);

        var deletedActivities = await DeleteInBatchesAsync(
            $"DELETE TOP ({DeleteBatchSize}) FROM dbo.UserActivity WHERE Timestamp < {{0}}", cutoff, cancellationToken);
        var deletedClicks = await DeleteInBatchesAsync(
            $"DELETE TOP ({DeleteBatchSize}) FROM dbo.UserClickEvent WHERE Timestamp < {{0}}", cutoff, cancellationToken);

        return (deletedActivities, deletedClicks);
    }

    public async Task<int> CleanupRollupRetentionAsync(int rollupRetentionDays, CancellationToken cancellationToken)
    {
        var cutoff = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-rollupRetentionDays));

        var total = 0;
        total += await DeleteInBatchesAsync(
            $"DELETE TOP ({DeleteBatchSize}) FROM dbo.UserActivityDaily WHERE ActivityDate < {{0}}", cutoff, cancellationToken);
        total += await DeleteInBatchesAsync(
            $"DELETE TOP ({DeleteBatchSize}) FROM dbo.FeatureUsageDaily WHERE ActivityDate < {{0}}", cutoff, cancellationToken);
        total += await DeleteInBatchesAsync(
            $"DELETE TOP ({DeleteBatchSize}) FROM dbo.UserFeatureUsageDaily WHERE ActivityDate < {{0}}", cutoff, cancellationToken);
        total += await DeleteInBatchesAsync(
            $"DELETE TOP ({DeleteBatchSize}) FROM dbo.WeeklyLoginAggregate WHERE WeekStartDate < {{0}}", cutoff, cancellationToken);
        return total;
    }

    /// <summary>
    /// Runs a <c>DELETE TOP (n)</c> statement until it stops matching rows, so a large backlog is
    /// drained as several short transactions rather than one long one.
    /// <para>
    /// <paramref name="sql"/> is a compile-time constant from this class (only the private
    /// <see cref="DeleteBatchSize"/> int is substituted into it — SQL Server won't parameterize
    /// TOP(n) in a DELETE). The cutoff, the one runtime value, is passed as a parameter.
    /// </para>
    /// </summary>
    private async Task<int> DeleteInBatchesAsync(string sql, object cutoff, CancellationToken cancellationToken)
    {
        var total = 0;
        int deleted;
        do
        {
            deleted = await _appDb.Database.ExecuteSqlRawAsync(sql, [cutoff], cancellationToken);
            total += deleted;
        }
        while (deleted >= DeleteBatchSize && !cancellationToken.IsCancellationRequested);
        return total;
    }
}
