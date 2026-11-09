using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Platform.Telemetry;
using GrainOriginatorPortal.Infrastructure.Platform.Telemetry.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Platform.Telemetry.Repositories;

/// <inheritdoc cref="IUsageTelemetryRepository"/>
public class UsageTelemetryRepository : IUsageTelemetryRepository
{
    /// <summary>Rows per DELETE statement when pruning the high-volume raw tables, so a retention
    /// backlog drains as several short transactions instead of one long log-growing one.</summary>
    private const int DeleteBatchSize = 5000;

    private const string TotalSubFeature = "__total__";

    private readonly ApplicationDbContext _appDb;
    private readonly TradeUnitPreferencesDbContext _entDb;

    public UsageTelemetryRepository(ApplicationDbContext appDb, TradeUnitPreferencesDbContext entDb)
    {
        _appDb = appDb;
        _entDb = entDb;
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
