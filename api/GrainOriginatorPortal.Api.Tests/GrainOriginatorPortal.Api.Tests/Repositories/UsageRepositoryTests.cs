// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Direct coverage of <see cref="UsageRepository"/> against InMemory contexts: the window and
/// user-set scoping every dashboard read applies, the raw-vs-rollup merge for "last active", the
/// session stitching the tracker does on each flush, and the four daily/weekly aggregation jobs
/// (both the first run and the idempotent re-run onto existing rows).
/// </summary>
/// <remarks>
/// Deliberately NOT tested here: <c>RefreshTradeUnitSnapshotAsync</c> (wipes with
/// <c>ExecuteSqlRawAsync</c> inside an explicit transaction), <c>CleanupUsageRetentionAsync</c> and
/// <c>CleanupRollupRetentionAsync</c> (batched <c>DELETE TOP</c> via <c>ExecuteSqlRawAsync</c>).
/// Those are raw T-SQL the InMemory provider cannot execute and belong to the real-SQL harness.
/// Case-insensitive matching on UserId is likewise left alone: InMemory compares ordinally while
/// Azure SQL does not, so an assertion either way would lie about production.
/// </remarks>
public class UsageRepositoryTests
{
    private static readonly DateTime Day = new(2026, 3, 10, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly DayOnly = DateOnly.FromDateTime(Day);

    /// <summary>The real context maps vw_UserManagerLookup keyless (it never writes), which the
    /// InMemory provider can't seed. This subclass adds a key purely so a test can arrange rows;
    /// the query under test is inherited unchanged.</summary>
    private sealed class SeedableEntitlements(DbContextOptions<TradeUnitPreferencesDbContext> options)
        : TradeUnitPreferencesDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            modelBuilder.Entity<UserManagerLookup>(e =>
            {
                e.ToTable("UserManagerLookup");
                e.HasKey(x => x.UserId);
            });
        }
    }

    private static (UsageRepository Sut, ApplicationDbContext App, OriginationDbContext Ods, TradeUnitPreferencesDbContext Ent) Build()
    {
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"usage-app-{Guid.NewGuid()}").Options);
        var ods = new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"usage-ods-{Guid.NewGuid()}").Options);
        var ent = new SeedableEntitlements(new DbContextOptionsBuilder<TradeUnitPreferencesDbContext>()
            .UseInMemoryDatabase($"usage-ent-{Guid.NewGuid()}").Options);

        return (new UsageRepository(app, ods, ent), app, ods, ent);
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
    // Excluded-user administration + identity
    // =========================================================================

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AddExcludedUser_InsertsOnce_ThenRejectsTheDuplicate()
    {
        var (sut, app, _, _) = Build();

        var first = await sut.AddExcludedUserAsync("svc-bot", "service account", "mgr", CancellationToken.None);
        var second = await sut.AddExcludedUserAsync("svc-bot", "again", "mgr", CancellationToken.None);

        Assert.NotNull(first);
        Assert.Equal("svc-bot", first!.UserId);
        Assert.Equal("mgr", first.CreatedBy);
        Assert.Null(second);                                        // pre-check turns the unique index into a clean null
        Assert.Equal(1, await app.UsageDashboardExcludedUsers.CountAsync());
        Assert.Equal(new[] { "svc-bot" }, await sut.GetExcludedUserIdsAsync(CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task RemoveExcludedUser_ReturnsWhetherARowWasRemoved()
    {
        var (sut, _, _, _) = Build();
        var row = await sut.AddExcludedUserAsync("svc-bot", null, "mgr", CancellationToken.None);

        Assert.True(await sut.RemoveExcludedUserAsync(row!.Id, CancellationToken.None));
        Assert.False(await sut.RemoveExcludedUserAsync(row.Id, CancellationToken.None));   // already gone
        Assert.Empty(await sut.GetExcludedUsersAsync(CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetExcludedUsers_OrdersByUserId()
    {
        var (sut, _, _, _) = Build();
        await sut.AddExcludedUserAsync("zed", null, "mgr", CancellationToken.None);
        await sut.AddExcludedUserAsync("amy", null, "mgr", CancellationToken.None);

        var rows = await sut.GetExcludedUsersAsync(CancellationToken.None);

        Assert.Equal(new[] { "amy", "zed" }, rows.Select(r => r.UserId));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task SnapshotReads_DistinctUsersAndDisplayNames_AcrossTradeUnitRows()
    {
        var (sut, app, _, _) = Build();
        app.UserTradeUnitSnapshots.AddRange(
            new UserTradeUnitSnapshot { UserId = "cegr", DisplayName = "Caden", TradeUnitCode = "4056", SnapshotDate = DayOnly },
            new UserTradeUnitSnapshot { UserId = "cegr", DisplayName = "Caden", TradeUnitCode = "2190", SnapshotDate = DayOnly },
            new UserTradeUnitSnapshot { UserId = "hcol", DisplayName = "Holly", TradeUnitCode = "4056", SnapshotDate = DayOnly });
        await app.SaveChangesAsync();

        var ids = await sut.GetSnapshotUserIdsAsync(CancellationToken.None);
        var names = await sut.GetDisplayNamesAsync(["cegr"], CancellationToken.None);

        Assert.Equal(new[] { "cegr", "hcol" }, ids.OrderBy(i => i));
        var name = Assert.Single(names);                             // one row per user, not per trade unit
        Assert.Equal(("cegr", "Caden"), (name.UserId, name.DisplayName));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetUserManagerLookup_ProjectsEveryRowOfTheView()
    {
        var (sut, _, _, ent) = Build();
        ent.UserManagerLookups.Add(new UserManagerLookup
        {
            UserId = "cegr", DisplayName = "Caden", HierId = "H1", IsManager = false,
            ManagerUserId = "boss", ManagerDisplayName = "The Boss", ManagerHierId = "H0"
        });
        await ent.SaveChangesAsync();

        var rows = await sut.GetUserManagerLookupAsync(CancellationToken.None);

        var row = Assert.Single(rows);
        Assert.Equal("cegr", row.UserId);
        Assert.Equal("boss", row.ManagerUserId);
        Assert.Equal("H0", row.ManagerHierId);
    }

    // =========================================================================
    // Activity reads: window is [from, to) and restricted to the caller's user set
    // =========================================================================

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetActiveUserIds_HonoursHalfOpenWindowAndUserSet()
    {
        var (sut, app, _, _) = Build();
        app.UserActivities.AddRange(
            Activity("in-window", 0),                                   // exactly `from` → included
            Activity("at-end", 24 * 60),                                // exactly `to` → excluded
            Activity("before", -1),
            Activity("not-asked", 30),                                  // active but outside the user set
            Activity("in-window", 45));                                 // second hit → still one id
        await app.SaveChangesAsync();

        var ids = await sut.GetActiveUserIdsAsync(Day, Day.AddDays(1), ["in-window", "at-end", "before"], CancellationToken.None);

        Assert.Equal(new[] { "in-window" }, ids);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetDailyActiveCounts_CountsDistinctUsersPerDay()
    {
        var (sut, app, _, _) = Build();
        app.UserActivities.AddRange(
            Activity("a", 10), Activity("a", 20), Activity("b", 30),    // day 1: a, b
            Activity("a", 10, day: Day.AddDays(1)));                    // day 2: a
        await app.SaveChangesAsync();

        var counts = await sut.GetDailyActiveCountsAsync(Day, Day.AddDays(2), ["a", "b"], CancellationToken.None);

        Assert.Equal(2, counts.Single(c => c.Date == DayOnly).Count);
        Assert.Equal(1, counts.Single(c => c.Date == DayOnly.AddDays(1)).Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetLastActiveByUser_MergesRawAndRollup_TakingTheLaterOfTheTwo()
    {
        var (sut, app, _, _) = Build();
        app.UserActivities.AddRange(
            Activity("raw-newer", 90),                                  // raw today beats an older rollup day
            Activity("rollup-newer", 0, day: Day.AddDays(-40)));        // raw is old, rollup day is newer
        app.UserActivityDailies.AddRange(
            Daily("raw-newer", DayOnly.AddDays(-5), requests: 3),
            Daily("rollup-newer", DayOnly.AddDays(-2), requests: 3),
            Daily("rollup-only", DayOnly.AddDays(-100), requests: 1),
            Daily("zero-day", DayOnly, requests: 0));                   // RequestCount 0 is not "active"
        await app.SaveChangesAsync();

        var rows = (await sut.GetLastActiveByUserAsync(["raw-newer", "rollup-newer", "rollup-only", "zero-day", "never"], CancellationToken.None))
            .ToDictionary(r => r.UserId, r => r.LastActive);

        Assert.Equal(Day.AddMinutes(90), rows["raw-newer"]);
        Assert.Equal(Day.AddDays(-2), rows["rollup-newer"]);
        Assert.Equal(Day.AddDays(-100), rows["rollup-only"]);
        Assert.False(rows.ContainsKey("zero-day"));
        Assert.False(rows.ContainsKey("never"));                        // never-logged-in users are simply absent
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task NotesCreatedCounts_OnlyCountPostsToNotesCreate()
    {
        var (sut, app, _, _) = Build();
        app.UserActivities.AddRange(
            Activity("a", 1, "customers", "notes-create", "POST"),
            Activity("a", 2, "build-a-list", "notes-create", "POST"),
            Activity("a", 3, "customers", "notes-create", "GET"),        // a read of the same endpoint
            Activity("a", 4, "customers", "notes-update", "POST"),       // a different sub-feature
            Activity("b", 5, "customers", "notes-create", "POST"));
        await app.SaveChangesAsync();

        var byUser = await sut.GetNotesCreatedCountsByUserAsync(Day, Day.AddDays(1), ["a", "b"], CancellationToken.None);
        var byFeature = await sut.GetNotesCreatedCountsByFeatureAsync(Day, Day.AddDays(1), ["a", "b"], CancellationToken.None);
        var breakdown = await sut.GetActivityBreakdownByUserAsync(Day, Day.AddDays(1), ["a"], CancellationToken.None);

        Assert.Equal(2, byUser.Single(u => u.UserId == "a").Count);
        Assert.Equal(1, byUser.Single(u => u.UserId == "b").Count);
        Assert.Equal(2, byFeature.Single(f => f.FeatureCode == "customers").Count);
        Assert.Equal(1, byFeature.Single(f => f.FeatureCode == "build-a-list").Count);
        Assert.Equal((2, 0), (breakdown.Single().NotesTaken, breakdown.Single().PlantingIntentionsAdded));
    }

    // =========================================================================
    // Sessions
    // =========================================================================

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetSessionStatsByUser_OptionalBoundsAndAverageDuration()
    {
        var (sut, app, _, _) = Build();
        app.UserSessions.AddRange(
            Session("a", Day.AddHours(1), 10),
            Session("a", Day.AddHours(2), 30),
            Session("a", Day.AddDays(-1), 100),                         // outside a bounded window
            Session("b", Day.AddHours(1), 5));
        await app.SaveChangesAsync();

        var unbounded = await sut.GetSessionStatsByUserAsync(null, null, ["a"], CancellationToken.None);
        var bounded = await sut.GetSessionStatsByUserAsync(Day, Day.AddDays(1), ["a"], CancellationToken.None);

        Assert.Equal((3, (10 + 30 + 100) / 3.0), (unbounded.Single().LoginCount, unbounded.Single().AvgDuration));
        Assert.Equal((2, 20.0), (bounded.Single().LoginCount, bounded.Single().AvgDuration));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ApplyActivitySessions_StartsExtendsAndSplitsSessionsOnTheGap()
    {
        var (sut, app, _, _) = Build();
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
        var (sut, app, _, _) = Build();
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
        var (sut, app, _, _) = Build();

        await sut.ApplyActivitySessionsAsync([], TimeSpan.FromMinutes(30), CancellationToken.None);

        Assert.Equal(0, await app.UserSessions.CountAsync());
    }

    // =========================================================================
    // Click reads
    // =========================================================================

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ContactCounts_CountOnlyCallAndEmailClicks()
    {
        var (sut, app, _, _) = Build();
        app.UserClickEvents.AddRange(
            Click("a", 1, "call_click"), Click("a", 2, "email_click"), Click("a", 3, "interaction"), Click("a", 4, "screen_enter"));
        await app.SaveChangesAsync();

        var counts = await sut.GetContactCountsByUserAsync(Day, Day.AddDays(1), ["a"], CancellationToken.None);

        Assert.Equal(2, counts.Single().Count);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(null, 3)]        // no screen → every feature
    [InlineData("all", 3)]
    [InlineData("  ", 3)]        // whitespace is "no screen"
    [InlineData("customers", 2)] // a specific screen narrows
    public async Task GetInteractionCounts_ScreenFilterNarrowsOnlyWhenARealScreenIsNamed(string? screen, int expectedGroups)
    {
        var (sut, app, _, _) = Build();
        app.UserClickEvents.AddRange(
            Click("a", 1, "interaction", "customers", "profile-opened"),
            Click("a", 2, "interaction", "customers", "profile-opened"),
            Click("a", 3, "interaction", "customers", "contracts"),
            Click("a", 4, "interaction", "build-a-list", "save-list"),
            Click("a", 5, "call_click", "customers", "phone"));            // not an interaction → never counted
        await app.SaveChangesAsync();

        var rows = await sut.GetInteractionCountsAsync(Day, Day.AddDays(1), ["a"], screen, CancellationToken.None);

        Assert.Equal(expectedGroups, rows.Count);
        Assert.Equal(2, rows.Single(r => r.FeatureCode == "customers" && r.SubFeatureCode == "profile-opened").Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetClickBreakdownByUser_CountsDistinctTargetsForProfilesAndContracts()
    {
        var (sut, app, _, _) = Build();
        app.UserClickEvents.AddRange(
            Click("a", 1, "interaction", "customers", "profile-opened", "C1"),
            Click("a", 2, "interaction", "customers", "profile-opened", "C1"),   // same producer twice → one profile
            Click("a", 3, "interaction", "customers", "profile-opened", "C2"),
            Click("a", 4, "interaction", "customers", "contracts", "K1"),
            Click("a", 5, "interaction", "customers", "producer-details", "C1"),
            Click("a", 6, "interaction", "customers", "producer-details", "C1"), // raw count, not distinct
            Click("a", 7, "interaction", "build-a-list", "save-list"),
            Click("a", 8, "call_click", "customers", "phone"),
            Click("a", 9, "email_click", "customers", "email"),
            Click("b", 1, "call_click", "customers", "phone"));                 // a user with no distinct targets at all
        await app.SaveChangesAsync();

        var rows = (await sut.GetClickBreakdownByUserAsync(Day, Day.AddDays(1), ["a", "b"], CancellationToken.None))
            .ToDictionary(r => r.UserId);

        var a = rows["a"];
        Assert.Equal((2, 1, 2, 1, 2), (a.ProfilesViewed, a.ContractsViewed, a.CallsEmails, a.ListsBuilt, a.ProducerDetails));
        var b = rows["b"];
        Assert.Equal((0, 0, 1), (b.ProfilesViewed, b.ContractsViewed, b.CallsEmails));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetFeatureUsers_UnionsActivityAndClickPairs()
    {
        var (sut, app, _, _) = Build();
        app.UserActivities.AddRange(Activity("a", 1, "customers"), Activity("a", 2, "customers"));
        app.UserClickEvents.AddRange(Click("a", 3, "screen_enter", "calculators"), Click("b", 4, "interaction", "customers"));
        await app.SaveChangesAsync();

        var pairs = await sut.GetFeatureUsersAsync(Day, Day.AddDays(1), ["a", "b"], CancellationToken.None);

        Assert.Equal(
            new[] { ("calculators", "a"), ("customers", "a"), ("customers", "b") },
            pairs.Select(p => (p.FeatureCode, p.UserId)).OrderBy(p => p));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task LibraryQueryUsageAndSearchGaps_RankByCountAndSkipNullTargets()
    {
        var (sut, app, _, _) = Build();
        app.UserClickEvents.AddRange(
            Click("a", 1, "interaction", "build-a-list", "library-query-selected", "7"),
            Click("a", 2, "interaction", "build-a-list", "library-query-selected", "7"),
            Click("a", 3, "interaction", "build-a-list", "library-query-selected", "3"),
            Click("a", 4, "interaction", "build-a-list", "library-query-selected", null),   // no target → ignored
            Click("a", 5, "interaction", "build-a-list", "library-search-no-match", "corn near omaha"),
            Click("a", 6, "interaction", "build-a-list", "library-search-no-match", "corn near omaha"),
            Click("a", 7, "interaction", "build-a-list", "library-search-no-match", "flax"));
        await app.SaveChangesAsync();

        var usage = await sut.GetLibraryQueryUsageAsync(Day, Day.AddDays(1), ["a"], CancellationToken.None);
        var gaps = await sut.GetQuerySearchGapsAsync(Day, Day.AddDays(1), ["a"], CancellationToken.None);

        Assert.Equal(new[] { ("7", 2), ("3", 1) }, usage.Select(u => (u.TargetId, u.Count)));
        Assert.Equal(new[] { ("corn near omaha", 2), ("flax", 1) }, gaps.Select(g => (g.SearchText, g.TimesSearched)));
    }

    // =========================================================================
    // Rollup reads
    // =========================================================================

    // -------------------------------------------------------------------------
    [Fact]
    public async Task RollupReads_RequireRequestCountAndHonourTheDateWindow()
    {
        var (sut, app, _, _) = Build();
        app.UserActivityDailies.AddRange(
            Daily("a", DayOnly, 5, sessions: 2, minutes: 30),
            Daily("a", DayOnly.AddDays(1), 1, sessions: 0, minutes: 0),
            Daily("b", DayOnly, 0),                                     // present but inactive
            Daily("c", DayOnly.AddDays(7), 9));                         // outside the window
        await app.SaveChangesAsync();

        var active = await sut.GetActiveUserIdsFromRollupAsync(DayOnly, DayOnly.AddDays(7), ["a", "b", "c"], CancellationToken.None);
        var daily = await sut.GetDailyActiveCountsFromRollupAsync(DayOnly, DayOnly.AddDays(7), ["a", "b", "c"], CancellationToken.None);

        Assert.Equal(new[] { "a" }, active);
        Assert.Equal(new[] { (DayOnly, 1), (DayOnly.AddDays(1), 1) }, daily.OrderBy(d => d.Date).Select(d => (d.Date, d.Count)));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetSessionStatsFromRollup_AveragesAcrossDays_AndNeverDividesByZero()
    {
        var (sut, app, _, _) = Build();
        app.UserActivityDailies.AddRange(
            Daily("a", DayOnly, 5, sessions: 2, minutes: 30),
            Daily("a", DayOnly.AddDays(1), 5, sessions: 1, minutes: 15),
            Daily("zero", DayOnly, 5, sessions: 0, minutes: 0));
        await app.SaveChangesAsync();

        var stats = (await sut.GetSessionStatsFromRollupAsync(DayOnly, DayOnly.AddDays(7), ["a", "zero"], CancellationToken.None))
            .ToDictionary(s => s.UserId);

        Assert.Equal((3, 15.0), (stats["a"].LoginCount, stats["a"].AvgDuration));
        Assert.Equal((0, 0.0), (stats["zero"].LoginCount, stats["zero"].AvgDuration));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task FeatureRollupReads_ScreenTimeOnTotalRowOnly_InteractionsRequireACount()
    {
        var (sut, app, _, _) = Build();
        app.UserFeatureUsageDailies.AddRange(
            new() { UserId = "a", ActivityDate = DayOnly, FeatureCode = "customers", SubFeatureCode = "__total__", ScreenMinutes = 12.5, InteractionCount = 0 },
            new() { UserId = "a", ActivityDate = DayOnly, FeatureCode = "customers", SubFeatureCode = "profile-opened", ScreenMinutes = 99, InteractionCount = 4 },
            new() { UserId = "b", ActivityDate = DayOnly, FeatureCode = "customers", SubFeatureCode = "__total__", ScreenMinutes = 2.5, InteractionCount = 0 },
            new() { UserId = "a", ActivityDate = DayOnly, FeatureCode = "calculators", SubFeatureCode = "__total__", ScreenMinutes = 1, InteractionCount = 3 });
        await app.SaveChangesAsync();

        var screen = await sut.GetFeatureScreenTimeFromRollupAsync(DayOnly, DayOnly.AddDays(1), ["a", "b"], CancellationToken.None);
        var all = await sut.GetInteractionCountsFromRollupAsync(DayOnly, DayOnly.AddDays(1), ["a", "b"], null, CancellationToken.None);
        var one = await sut.GetInteractionCountsFromRollupAsync(DayOnly, DayOnly.AddDays(1), ["a", "b"], "customers", CancellationToken.None);
        var users = await sut.GetFeatureUsersFromRollupAsync(DayOnly, DayOnly.AddDays(1), ["a", "b"], CancellationToken.None);

        Assert.Equal(15.0, screen.Single(s => s.FeatureCode == "customers").Minutes);   // 12.5 + 2.5, the 99 sub-row ignored
        Assert.Equal(2, all.Count);                                                      // only rows with interactions
        Assert.Equal(("customers", "profile-opened", 4), (one.Single().FeatureCode, one.Single().SubFeatureCode, one.Single().Count));
        Assert.Equal(3, users.Count);                                                    // (customers,a) (customers,b) (calculators,a)
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetWeeklyLoginRollup_CountsUsersWithSessionsPerWeek()
    {
        var (sut, app, _, _) = Build();
        var week = new DateOnly(2026, 3, 9);
        app.WeeklyLoginAggregates.AddRange(
            new() { WeekStartDate = week, UserId = "a", SessionCount = 3 },
            new() { WeekStartDate = week, UserId = "b", SessionCount = 1 },
            new() { WeekStartDate = week, UserId = "c", SessionCount = 0 },           // no sessions → not active
            new() { WeekStartDate = week.AddDays(-7), UserId = "a", SessionCount = 9 }); // before `since`
        await app.SaveChangesAsync();

        var rows = await sut.GetWeeklyLoginRollupAsync(week, ["a", "b", "c"], CancellationToken.None);

        var row = Assert.Single(rows);
        Assert.Equal((week, 2, 4), (row.WeekStart, row.ActiveUsers, row.SessionCount));
    }

    // =========================================================================
    // Name lookups
    // =========================================================================

    // -------------------------------------------------------------------------
    [Fact]
    public async Task NameLookups_EmptyIdSetsShortCircuit_AndCodesAreAppendedOnlyWhenPresent()
    {
        var (sut, app, ods, _) = Build();
        app.Customers.AddRange(
            new Customer { Id = 1, Name = "Smith Farm", ScoularId = "SMITH" },
            new Customer { Id = 2, Name = "Manual Farm", ScoularId = null });
        app.QueryLibrary.Add(new QueryLibraryItem { Id = 7, Name = "Corn producers", Category = "Crops" });
        await app.SaveChangesAsync();
        ods.Contracts.AddRange(
            new Contract { Id = 10, ContractNumber = "P1", CommodityCode = "YC" },
            new Contract { Id = 11, ContractNumber = "P2", CommodityCode = "" });
        await ods.SaveChangesAsync();

        Assert.Empty(await sut.GetQueryLibraryNamesAsync([], CancellationToken.None));
        Assert.Empty(await sut.GetCustomerDisplayNamesAsync([], CancellationToken.None));
        Assert.Empty(await sut.GetContractDisplayNamesAsync([], CancellationToken.None));

        var queries = await sut.GetQueryLibraryNamesAsync([7, 99], CancellationToken.None);
        var customers = await sut.GetCustomerDisplayNamesAsync([1, 2, 99], CancellationToken.None);
        var contracts = await sut.GetContractDisplayNamesAsync([10, 11], CancellationToken.None);
        var snapshot = await sut.GetCustomerNameAsync(1, CancellationToken.None);

        Assert.Equal("Corn producers", Assert.Single(queries).Value);
        Assert.Equal("Smith Farm (SMITH)", customers["1"]);
        Assert.Equal("Manual Farm", customers["2"]);
        Assert.False(customers.ContainsKey("99"));
        Assert.Equal("P1 — YC", contracts["10"]);
        Assert.Equal("P2", contracts["11"]);
        Assert.Equal(new CustomerNameSnapshot(1, "Smith Farm", "SMITH"), snapshot);
        Assert.Null(await sut.GetCustomerNameAsync(99, CancellationToken.None));
    }

    // =========================================================================
    // Aggregation jobs
    // =========================================================================

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AggregateUserActivityDaily_BuildsOneRowPerUser_AndRerunUpdatesInPlace()
    {
        var (sut, app, _, _) = Build();
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
        var (sut, app, _, _) = Build();
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
        var (sut, app, _, _) = Build();
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
        var (sut, app, _, _) = Build();
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
        var (sut, app, _, _) = Build();

        await sut.AddActivitiesAndClicksAsync([Activity("a", 1), Activity("b", 2)], [Click("a", 3, "call_click")], CancellationToken.None);

        Assert.Equal(2, await app.UserActivities.CountAsync());
        Assert.Equal(1, await app.UserClickEvents.CountAsync());
    }
}
