// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Direct coverage of <see cref="UsageTelemetryRepository"/> against InMemory contexts: the session stitching the
/// tracker does on each flush, and the four daily/weekly aggregation jobs (both the first run and the idempotent
/// re-run onto existing rows).
/// </summary>
/// <remarks>
/// Deliberately NOT tested here: <c>RefreshTradeUnitSnapshotAsync</c> (wipes with <c>ExecuteSqlRawAsync</c> inside an
/// explicit transaction), <c>CleanupUsageRetentionAsync</c> and <c>CleanupRollupRetentionAsync</c> (batched
/// <c>DELETE TOP</c> via <c>ExecuteSqlRawAsync</c>). Those are raw T-SQL the InMemory provider cannot execute and belong
/// to the real-SQL harness.
/// </remarks>
public class UsageTelemetryRepositoryTests
{
    private static readonly DateTime Day = new(2026, 3, 10, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly DayOnly = DateOnly.FromDateTime(Day);

    private static (UsageTelemetryRepository Sut, ApplicationDbContext App) Build()
    {
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"usage-telemetry-app-{Guid.NewGuid()}").Options);
        var ent = new TradeUnitPreferencesDbContext(new DbContextOptionsBuilder<TradeUnitPreferencesDbContext>()
            .UseInMemoryDatabase($"usage-telemetry-ent-{Guid.NewGuid()}").Options);

        return (new UsageTelemetryRepository(app, ent), app);
    }

    private static UserActivity Activity(string user, int minuteOfDay, string feature = "customers",
        string? subFeature = null, string method = "GET", DateTime? day = null) => new()
    {
        UserId = user, FeatureCode = feature, SubFeatureCode = subFeature, HttpMethod = method,
        Path = "/api/x", Timestamp = (day ?? Day).AddMinutes(minuteOfDay)
    };

    private static UserClickEvent Click(string user, int minuteOfDay, string eventType, string feature = "customers",
        string? subFeature = null, string? target = null, DateTime? day = null) => new()
    {
        UserId = user, EventType = eventType, FeatureCode = feature, SubFeatureCode = subFeature,
        TargetId = target, Timestamp = (day ?? Day).AddMinutes(minuteOfDay)
    };

    private static UserSession Session(string user, DateTime login, int durationMinutes) => new()
    {
        UserId = user, LoginTime = login, LastActivityTime = login.AddMinutes(durationMinutes), DurationMinutes = durationMinutes
    };

    private static UserActivityDaily Daily(string user, DateOnly date, int requests, int sessions = 0, int minutes = 0) => new()
    {
        UserId = user, ActivityDate = date, RequestCount = requests, SessionCount = sessions, TotalSessionMinutes = minutes
    };

    // =========================================================================
    // Session stitching
    // =========================================================================

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ApplyActivitySessions_StartsExtendsAndSplitsSessionsOnTheGap()
    {
        var (sut, app) = Build();
        var gap = TimeSpan.FromMinutes(30);

        // First flush: nobody has a session yet → one per user.
        await sut.ApplyActivitySessionsAsync([Activity("a", 0), Activity("a", 5), Activity("b", 0)], gap, CancellationToken.None);
        Assert.Equal(2, await app.UserSessions.CountAsync());
        var a = await app.UserSessions.SingleAsync(s => s.UserId == "a");
        Assert.Equal((Day.AddMinutes(5), Day.AddMinutes(5)), (a.LoginTime, a.LastActivityTime));   // a session opens at the latest timestamp in the flush

        // Second flush inside the gap: extends a, leaves b alone.
        await sut.ApplyActivitySessionsAsync([Activity("a", 20)], gap, CancellationToken.None);
        a = await app.UserSessions.SingleAsync(s => s.UserId == "a");
        Assert.Equal(2, await app.UserSessions.CountAsync());
        Assert.Equal((Day.AddMinutes(5), Day.AddMinutes(20)), (a.LoginTime, a.LastActivityTime));

        // Third flush beyond the gap: a new session, the old one untouched.
        await sut.ApplyActivitySessionsAsync([Activity("a", 20 + 31)], gap, CancellationToken.None);
        var sessions = await app.UserSessions.Where(s => s.UserId == "a").OrderBy(s => s.LoginTime).ToListAsync();
        Assert.Equal(2, sessions.Count);
        Assert.Equal(Day.AddMinutes(20), sessions[0].LastActivityTime);
        Assert.Equal(Day.AddMinutes(51), sessions[1].LoginTime);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ApplyActivitySessions_LateArrivingOlderActivity_NeverMovesLastActivityBackwards()
    {
        var (sut, app) = Build();
        var gap = TimeSpan.FromMinutes(30);
        await sut.ApplyActivitySessionsAsync([Activity("a", 10)], gap, CancellationToken.None);

        await sut.ApplyActivitySessionsAsync([Activity("a", 4)], gap, CancellationToken.None);

        var session = await app.UserSessions.SingleAsync();
        Assert.Equal(Day.AddMinutes(10), session.LastActivityTime);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ApplyActivitySessions_EmptyBatch_IsANoOp()
    {
        var (sut, app) = Build();

        await sut.ApplyActivitySessionsAsync([], TimeSpan.FromMinutes(30), CancellationToken.None);

        Assert.Equal(0, await app.UserSessions.CountAsync());
    }


    // =========================================================================
    // Aggregation jobs
    // =========================================================================

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AggregateUserActivityDaily_BuildsOneRowPerUser_AndRerunUpdatesInPlace()
    {
        var (sut, app) = Build();
        app.UserActivities.AddRange(
            Activity("a", 1, "customers", "customer-details"),
            Activity("a", 2, "customers", "contracts"),
            Activity("a", 3, "customers", "notes-create", "POST"),
            Activity("a", 4, "build-a-list", "save-list"),
            Activity("a", 5, "customers", "planting-intentions", "POST"),
            Activity("a", 6, "customers", "planting-intentions", "GET"),   // reads don't count as "added"
            Activity("a", 7, "customers", "producer-details"),
            Activity("a", 1, day: Day.AddDays(1)),                           // tomorrow → not in this day's row
            Activity("b", 1));
        app.UserSessions.AddRange(Session("a", Day.AddHours(1), 10), Session("a", Day.AddHours(5), 20));
        app.UserClickEvents.AddRange(Click("a", 1, "call_click"), Click("a", 2, "email_click"), Click("a", 3, "email_click"));
        await app.SaveChangesAsync();

        await sut.AggregateUserActivityDailyAsync(DayOnly, CancellationToken.None);

        var a = await app.UserActivityDailies.SingleAsync(d => d.UserId == "a");
        Assert.Equal(7, a.RequestCount);
        Assert.Equal((2, 30), (a.SessionCount, a.TotalSessionMinutes));
        Assert.Equal((1, 1, 1, 1, 1, 1), (a.CustomersViewed, a.ContractsViewed, a.NotesCreated, a.ListsBuilt, a.PlantingIntentionsAdded, a.ProducerDetailsViewed));
        Assert.Equal((1, 2), (a.CallClicks, a.EmailClicks));
        var b = await app.UserActivityDailies.SingleAsync(d => d.UserId == "b");
        Assert.Equal((1, 0, 0), (b.RequestCount, b.SessionCount, b.CallClicks));   // no sessions / clicks → zeros, not missing

        // Re-run after more activity lands: the existing row is updated, not duplicated.
        app.UserActivities.Add(Activity("a", 8));
        await app.SaveChangesAsync();
        await sut.AggregateUserActivityDailyAsync(DayOnly, CancellationToken.None);

        Assert.Equal(2, await app.UserActivityDailies.CountAsync(d => d.ActivityDate == DayOnly));
        Assert.Equal(8, (await app.UserActivityDailies.SingleAsync(d => d.UserId == "a")).RequestCount);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AggregateFeatureUsageDaily_GroupsNullSubFeatureUnderTotal_AndCountsUniqueUsers()
    {
        var (sut, app) = Build();
        app.UserActivities.AddRange(
            Activity("a", 1, "customers"), Activity("a", 2, "customers"), Activity("b", 3, "customers"),   // __total__: 3 requests, 2 users
            Activity("a", 4, "customers", "contracts"));
        app.UserClickEvents.AddRange(
            Click("a", 1, "interaction", "customers"), Click("b", 2, "interaction", "customers"),
            Click("a", 3, "interaction", "customers", "contracts"));
        app.FeatureUsageDailies.Add(new FeatureUsageDaily
        {
            ActivityDate = DayOnly, FeatureCode = "customers", SubFeatureCode = "__total__", RequestCount = 999, SessionCount = 42
        });
        await app.SaveChangesAsync();

        await sut.AggregateFeatureUsageDailyAsync(DayOnly, CancellationToken.None);

        var rows = await app.FeatureUsageDailies.Where(f => f.ActivityDate == DayOnly).ToListAsync();
        Assert.Equal(2, rows.Count);                                                       // the stale row was reused
        var total = rows.Single(r => r.SubFeatureCode == "__total__");
        Assert.Equal((3, 2, 2, 0), (total.RequestCount, total.UniqueUsers, total.ClickCount, total.SessionCount));
        var contracts = rows.Single(r => r.SubFeatureCode == "contracts");
        Assert.Equal((1, 1, 1), (contracts.RequestCount, contracts.UniqueUsers, contracts.ClickCount));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AggregateUserFeatureUsageDaily_IncludesClickOnlyFeatures_AndPutsScreenTimeOnTotalOnly()
    {
        var (sut, app) = Build();
        app.UserActivities.AddRange(Activity("a", 1, "customers"), Activity("a", 2, "customers", "contracts"));
        app.UserClickEvents.AddRange(
            Click("a", 3, "interaction", "customers", "contracts"),
            Click("a", 0, "screen_enter", "calculators"),           // click-only feature: no API rows at all
            Click("a", 10, "screen_enter", "customers"),            // 10 minutes on calculators, then …
            Click("a", 12, "screen_enter", "customers", "contracts"), // 2 minutes on customers, then the trailing minute
            Click("a", 5, "interaction", "calculators", "mix"));
        await app.SaveChangesAsync();

        await sut.AggregateUserFeatureUsageDailyAsync(DayOnly, CancellationToken.None);

        var rows = (await app.UserFeatureUsageDailies.Where(r => r.ActivityDate == DayOnly).ToListAsync())
            .ToDictionary(r => (r.FeatureCode, r.SubFeatureCode));

        Assert.Equal((0, 0, 10.0), Pick(rows[("calculators", "__total__")]));
        Assert.Equal((0, 1, 0.0), Pick(rows[("calculators", "mix")]));
        Assert.Equal((1, 0, 3.0), Pick(rows[("customers", "__total__")]));      // 2 min + 1 trailing minute
        Assert.Equal((1, 1, 0.0), Pick(rows[("customers", "contracts")]));      // screen time never lands on a sub-feature
        Assert.Equal(4, rows.Count);

        static (int, int, double) Pick(UserFeatureUsageDaily r) => (r.RequestCount, r.InteractionCount, r.ScreenMinutes);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AggregateWeeklyLogins_LoginCountIsActiveDays_AndRerunReusesTheRow()
    {
        var (sut, app) = Build();
        var week = new DateOnly(2026, 3, 9);
        app.UserActivityDailies.AddRange(
            Daily("a", week, 5, sessions: 2, minutes: 30),
            Daily("a", week.AddDays(1), 0, sessions: 0, minutes: 0),      // a row with no requests is not an active day
            Daily("a", week.AddDays(6), 1, sessions: 1, minutes: 5),
            Daily("a", week.AddDays(7), 9, sessions: 9, minutes: 90));    // next week
        await app.SaveChangesAsync();

        await sut.AggregateWeeklyLoginsAsync(week, CancellationToken.None);
        await sut.AggregateWeeklyLoginsAsync(week, CancellationToken.None);

        var row = await app.WeeklyLoginAggregates.SingleAsync();
        Assert.Equal((week, "a", 2, 3, 35), (row.WeekStartDate, row.UserId, row.LoginCount, row.SessionCount, row.TotalSessionMin));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AddActivitiesAndClicks_PersistsBothBatches()
    {
        var (sut, app) = Build();

        await sut.AddActivitiesAndClicksAsync([Activity("a", 1), Activity("b", 2)], [Click("a", 3, "call_click")], CancellationToken.None);

        Assert.Equal(2, await app.UserActivities.CountAsync());
        Assert.Equal(1, await app.UserClickEvents.CountAsync());
    }
}
