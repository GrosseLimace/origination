using Microsoft.EntityFrameworkCore;
using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Background service that runs periodic aggregation jobs:
/// 1. Daily user activity aggregation (UserActivityDaily)
/// 2. Daily feature usage aggregation (FeatureUsageDaily)
/// 3. Weekly login aggregation (WeeklyLoginAggregate)
/// 4. Trade unit snapshot refresh (UserTradeUnitSnapshot)
/// 5. Retention cleanup (90-day delete on raw tables)
/// Runs every hour; full daily run triggers for the previous day's data.
/// </summary>
public class UsageAggregationBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<UsageAggregationBackgroundService> _logger;
    private static readonly TimeSpan RunInterval = TimeSpan.FromHours(1);
    private const int RetentionDays = 90;

    public UsageAggregationBackgroundService(
        IServiceScopeFactory scopeFactory,
        ILogger<UsageAggregationBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("UsageAggregationBackgroundService started");

        // Wait 30 seconds on startup to let the app stabilize
        await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);

        // Run snapshot immediately on startup
        await RefreshTradeUnitSnapshotAsync(stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var yesterday = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1));

                await AggregateUserActivityDailyAsync(yesterday, stoppingToken);
                await AggregateFeatureUsageDailyAsync(yesterday, stoppingToken);

                // Weekly aggregation: run if yesterday was Sunday (end of week)
                if (yesterday.DayOfWeek == DayOfWeek.Sunday)
                {
                    var weekStart = yesterday.AddDays(-6); // Monday
                    await AggregateWeeklyLoginsAsync(weekStart, stoppingToken);
                }

                await RefreshTradeUnitSnapshotAsync(stoppingToken);
                await CleanupRetentionAsync(stoppingToken);

                _logger.LogInformation("Aggregation cycle completed for {Date}", yesterday);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during aggregation cycle");
            }

            await Task.Delay(RunInterval, stoppingToken);
        }

        _logger.LogInformation("UsageAggregationBackgroundService stopped");
    }

    private async Task AggregateUserActivityDailyAsync(DateOnly date, CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        var dayStart = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var dayEnd = dayStart.AddDays(1);

        // Get all users active on this date
        var userActivities = await db.UserActivities
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

        // Get session data for the date
        var userSessions = await db.UserSessions
            .Where(s => s.LoginTime >= dayStart && s.LoginTime < dayEnd)
            .GroupBy(s => s.UserId)
            .Select(g => new
            {
                UserId = g.Key,
                SessionCount = g.Count(),
                TotalSessionMinutes = g.Sum(s => s.DurationMinutes)
            })
            .ToListAsync(cancellationToken);
        var sessionLookup = userSessions.ToDictionary(s => s.UserId, StringComparer.OrdinalIgnoreCase);

        // Get click events for the date
        var userClicks = await db.UserClickEvents
            .Where(c => c.Timestamp >= dayStart && c.Timestamp < dayEnd)
            .GroupBy(c => c.UserId)
            .Select(g => new
            {
                UserId = g.Key,
                CallClicks = g.Count(c => c.EventType == "call_click"),
                EmailClicks = g.Count(c => c.EventType == "email_click")
            })
            .ToListAsync(cancellationToken);
        var clickLookup = userClicks.ToDictionary(c => c.UserId, StringComparer.OrdinalIgnoreCase);

        foreach (var ua in userActivities)
        {
            sessionLookup.TryGetValue(ua.UserId, out var sessions);
            clickLookup.TryGetValue(ua.UserId, out var clicks);

            var existing = await db.UserActivityDailies
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
                db.UserActivityDailies.Add(new UserActivityDaily
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

        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task AggregateFeatureUsageDailyAsync(DateOnly date, CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        var dayStart = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var dayEnd = dayStart.AddDays(1);

        // Activity-based feature usage
        var featureGroups = await db.UserActivities
            .Where(a => a.Timestamp >= dayStart && a.Timestamp < dayEnd)
            .GroupBy(a => new { a.FeatureCode, SubFeatureCode = a.SubFeatureCode ?? "__total__" })
            .Select(g => new
            {
                g.Key.FeatureCode,
                g.Key.SubFeatureCode,
                RequestCount = g.Count(),
                UniqueUsers = g.Select(a => a.UserId).Distinct().Count()
            })
            .ToListAsync(cancellationToken);

        // Click-based feature usage
        var clickGroups = await db.UserClickEvents
            .Where(c => c.Timestamp >= dayStart && c.Timestamp < dayEnd)
            .GroupBy(c => new { c.FeatureCode, SubFeatureCode = c.SubFeatureCode ?? "__total__" })
            .Select(g => new
            {
                g.Key.FeatureCode,
                g.Key.SubFeatureCode,
                ClickCount = g.Count()
            })
            .ToListAsync(cancellationToken);
        var clickLookup = clickGroups.ToDictionary(
            c => (c.FeatureCode, c.SubFeatureCode),
            c => c.ClickCount);

        foreach (var fg in featureGroups)
        {
            clickLookup.TryGetValue((fg.FeatureCode, fg.SubFeatureCode), out var clickCount);

            var existing = await db.FeatureUsageDailies
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
                db.FeatureUsageDailies.Add(new FeatureUsageDaily
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

        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task AggregateWeeklyLoginsAsync(DateOnly weekStart, CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        var weekEnd = weekStart.AddDays(7);

        var weeklyData = await db.UserActivityDailies
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
            var existing = await db.WeeklyLoginAggregates
                .FirstOrDefaultAsync(w => w.WeekStartDate == weekStart && w.UserId == wd.UserId, cancellationToken);

            if (existing != null)
            {
                existing.LoginCount = wd.LoginCount;
                existing.SessionCount = wd.SessionCount;
                existing.TotalSessionMin = wd.TotalSessionMin;
            }
            else
            {
                db.WeeklyLoginAggregates.Add(new WeeklyLoginAggregate
                {
                    WeekStartDate = weekStart,
                    UserId = wd.UserId,
                    LoginCount = wd.LoginCount,
                    SessionCount = wd.SessionCount,
                    TotalSessionMin = wd.TotalSessionMin
                });
            }
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task RefreshTradeUnitSnapshotAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var entDb = scope.ServiceProvider.GetRequiredService<EntitlementsDbContext>();
            var appDb = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

            // Load current entitlements and deduplicate by (UserId, TradeUnitCode)
            var entitlements = await entDb.UserTradeUnitAccess.ToListAsync(cancellationToken);
            var deduped = entitlements
                .GroupBy(e => $"{e.UserId}|{e.TradeUnitCode}".ToUpperInvariant())
                .Select(g => g.First())
                .ToList();

            // Use raw SQL DELETE then a fresh DbContext scope to avoid EF tracking conflicts
            await appDb.Database.ExecuteSqlRawAsync("DELETE FROM dbo.UserTradeUnitSnapshot", cancellationToken);
            await appDb.SaveChangesAsync(cancellationToken); // flush the delete

            // Insert with a fresh scope so the change tracker is clean
            using var insertScope = _scopeFactory.CreateScope();
            var insertDb = insertScope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            foreach (var batch in deduped.Chunk(200))
            {
                foreach (var e in batch)
                {
                    insertDb.UserTradeUnitSnapshots.Add(new UserTradeUnitSnapshot
                    {
                        UserId = e.UserId,
                        DisplayName = e.DisplayName,
                        TradeUnitCode = e.TradeUnitCode,
                        GroupName = e.GroupName,
                        SnapshotDate = today
                    });
                }
                await insertDb.SaveChangesAsync(cancellationToken);
                insertDb.ChangeTracker.Clear();
            }

            _logger.LogInformation("Refreshed trade unit snapshot with {Count} unique entries (from {Raw} raw)", deduped.Count, entitlements.Count);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to refresh trade unit snapshot");
        }
    }

    private async Task CleanupRetentionAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        var cutoff = DateTime.UtcNow.AddDays(-RetentionDays);

        var deletedActivities = await db.Database.ExecuteSqlRawAsync(
            "DELETE FROM dbo.UserActivity WHERE Timestamp < {0}", [cutoff], cancellationToken);

        var deletedClicks = await db.Database.ExecuteSqlRawAsync(
            "DELETE FROM dbo.UserClickEvent WHERE Timestamp < {0}", [cutoff], cancellationToken);

        if (deletedActivities > 0 || deletedClicks > 0)
        {
            _logger.LogInformation("Retention cleanup: deleted {Activities} activities and {Clicks} click events older than {Days} days",
                deletedActivities, deletedClicks, RetentionDays);
        }
    }
}
