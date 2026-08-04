// Microsoft namespaces
using Microsoft.Extensions.Caching.Memory;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Covers the dashboard's user universe (Entra access set ∩ entitlements snapshot − exclusions,
/// and how it is cached), the summary's averaging, the date-window contract, and the
/// excluded-users administration flow.
/// </summary>
public class UsageDashboardServiceTests
{
    private readonly Mock<IUsageRepository> _repoMock = new();
    private readonly Mock<IAppAccessService> _appAccessMock = new();
    private readonly UsageUniverseCacheState _cacheState = new();
    private readonly UsageDashboardService _sut;

    private static readonly DateOnly From = new(2026, 7, 1);
    private static readonly DateOnly To = new(2026, 7, 20);

    public UsageDashboardServiceTests()
    {
        // Loose defaults: no activity/session/click/note data — every user shows "Never Logged In".
        _repoMock.Setup(r => r.GetDisplayNamesAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new UserDisplayName("CEgr", "Caden Egr")]);
        _repoMock.Setup(r => r.GetLastActivityByUserAsync(It.IsAny<DateTime?>(), It.IsAny<DateTime?>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        _repoMock.Setup(r => r.GetSessionStatsByUserAsync(It.IsAny<DateTime?>(), It.IsAny<DateTime?>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        _repoMock.Setup(r => r.GetSessionStatsFromRollupAsync(It.IsAny<DateOnly>(), It.IsAny<DateOnly>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        _repoMock.Setup(r => r.GetActiveUserIdsAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        _repoMock.Setup(r => r.GetActiveUserIdsFromRollupAsync(It.IsAny<DateOnly>(), It.IsAny<DateOnly>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        _repoMock.Setup(r => r.GetDailyActiveCountsAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        _repoMock.Setup(r => r.GetDailyActiveCountsFromRollupAsync(It.IsAny<DateOnly>(), It.IsAny<DateOnly>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        _repoMock.Setup(r => r.GetFeatureUsersAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        _repoMock.Setup(r => r.GetFeatureUsersFromRollupAsync(It.IsAny<DateOnly>(), It.IsAny<DateOnly>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        _repoMock.Setup(r => r.GetContactCountsByUserAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        _repoMock.Setup(r => r.GetNotesCreatedCountsByUserAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        _sut = CreateSut();
    }

    /// <summary>Builds the service, seeding the DB-backed exclusion list
    /// (dbo.UsageDashboardExcludedUsers) via the repo mock.</summary>
    private UsageDashboardService CreateSut(params string[] excludeUsers)
    {
        _repoMock.Setup(r => r.GetExcludedUserIdsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(excludeUsers.ToList());
        // A real cache (not a mock) so the memoization tests exercise the actual code path. The app's
        // cache is registered with a SizeLimit; setting one here proves entries declare their size.
        var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 100 });
        return new UsageDashboardService(_repoMock.Object, _appAccessMock.Object, cache, _cacheState);
    }

    private void SetupAccess(bool available, params string[] shortNames)
    {
        var set = available
            ? new AppAccessSet
            {
                Available = true,
                ShortNames = new HashSet<string>(shortNames, StringComparer.OrdinalIgnoreCase),
                DisplayNames = shortNames.ToDictionary(n => n, n => $"{n} (Entra)", StringComparer.OrdinalIgnoreCase)
            }
            : AppAccessSet.Unavailable;
        _appAccessMock.Setup(a => a.GetAccessSetAsync(It.IsAny<CancellationToken>())).ReturnsAsync(set);
    }

    // ── User universe ────────────────────────────────────────────────────────

    [Fact]
    public async Task AllUsers_WithAccessSet_UniverseIsTheAccessGroup_NotTheSnapshot()
    {
        SetupAccess(true, "CEgr", "admin-CEgr");

        var users = await _sut.GetUsersAsync(From, To, tradeUnitKey: null, status: null, CancellationToken.None);

        Assert.Equal(2, users.Count);
        Assert.Contains(users, u => u.UserId == "CEgr");
        Assert.Contains(users, u => u.UserId == "admin-CEgr"); // access-only user appears
        // The snapshot is never consulted for the unfiltered universe.
        _repoMock.Verify(r => r.GetSnapshotUserIdsAsync(It.IsAny<IReadOnlyCollection<string>?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task AllUsers_WithAccessSet_EntitledButNoAccessUser_IsHidden()
    {
        SetupAccess(true, "CEgr"); // JNoAccess is entitled (snapshot) but not in the group

        var users = await _sut.GetUsersAsync(From, To, tradeUnitKey: null, status: null, CancellationToken.None);

        Assert.Single(users);
        Assert.DoesNotContain(users, u => u.UserId == "JNoAccess");
    }

    [Fact]
    public async Task AllUsers_AccessUnavailable_FallsOpenToSnapshot()
    {
        SetupAccess(false);
        _repoMock.Setup(r => r.GetSnapshotUserIdsAsync(null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(["CEgr", "JNoAccess"]);

        var users = await _sut.GetUsersAsync(From, To, tradeUnitKey: null, status: null, CancellationToken.None);

        // Pre-existing behavior: full entitlements directory.
        Assert.Equal(2, users.Count);
        Assert.Contains(users, u => u.UserId == "JNoAccess");
    }

    [Fact]
    public async Task TradeUnitFilter_WithAccessSet_IntersectsSnapshotWithAccess()
    {
        SetupAccess(true, "CEgr", "admin-CEgr");
        _repoMock.Setup(r => r.GetSnapshotUserIdsAsync(
                It.Is<IReadOnlyCollection<string>>(c => c.Contains("TU1")), It.IsAny<CancellationToken>()))
            .ReturnsAsync(["CEgr", "JNoAccess"]); // both entitled to TU1; only CEgr has access

        var users = await _sut.GetUsersAsync(From, To, tradeUnitKey: "TU1", status: null, CancellationToken.None);

        Assert.Single(users);
        Assert.Equal("CEgr", users[0].UserId);
        // admin-CEgr has access but no TU1 entitlement → correctly absent from the TU view.
    }

    [Fact]
    public async Task DisplayName_FallsBackToEntraName_ForAccessOnlyUsers()
    {
        SetupAccess(true, "CEgr", "admin-CEgr"); // snapshot only knows CEgr's name

        var users = await _sut.GetUsersAsync(From, To, tradeUnitKey: null, status: null, CancellationToken.None);

        Assert.Equal("Caden Egr", users.Single(u => u.UserId == "CEgr").DisplayName);          // snapshot name wins
        Assert.Equal("admin-CEgr (Entra)", users.Single(u => u.UserId == "admin-CEgr").DisplayName); // Entra fallback
    }

    [Fact]
    public async Task ExcludeUsers_DropsConfiguredItDevAccounts_CaseInsensitive_FromEveryView()
    {
        SetupAccess(true, "CEgr", "admin-CEgr", "KHague");
        // The exclusion rows use different casing than the access set to prove case-insensitive matching.
        var sut = CreateSut("cegr", "ADMIN-CEGR");

        var users = await sut.GetUsersAsync(From, To, tradeUnitKey: null, status: null, CancellationToken.None);

        Assert.Single(users);
        Assert.Equal("KHague", users[0].UserId); // only the non-excluded originator remains
    }

    [Fact]
    public async Task ExcludeUsers_AppliesToTradeUnitFilteredViews_Too()
    {
        SetupAccess(true, "CEgr", "SFletcher");
        _repoMock.Setup(r => r.GetSnapshotUserIdsAsync(
                It.Is<IReadOnlyCollection<string>>(c => c.Contains("TU1")), It.IsAny<CancellationToken>()))
            .ReturnsAsync(["CEgr", "SFletcher"]); // both entitled + have access
        var sut = CreateSut("SFletcher");

        var users = await sut.GetUsersAsync(From, To, tradeUnitKey: "TU1", status: null, CancellationToken.None);

        Assert.Single(users);
        Assert.Equal("CEgr", users[0].UserId); // SFletcher excluded even within a TU filter
    }

    // ── Universe caching ─────────────────────────────────────────────────────

    [Fact]
    public async Task Universe_IsResolvedOnce_AcrossMultipleEndpointCalls()
    {
        // A dashboard page load hits ~12 endpoints; each used to re-read the snapshot and the
        // exclusion table. They should now share one cached universe.
        SetupAccess(false);
        _repoMock.Setup(r => r.GetSnapshotUserIdsAsync(null, It.IsAny<CancellationToken>())).ReturnsAsync(["CEgr"]);

        await _sut.GetUsersAsync(From, To, null, null, CancellationToken.None);
        await _sut.GetSummaryAsync(From, To, null, CancellationToken.None);
        await _sut.GetDailyActiveAsync(From, To, null, CancellationToken.None);

        _repoMock.Verify(r => r.GetSnapshotUserIdsAsync(null, It.IsAny<CancellationToken>()), Times.Once);
        _repoMock.Verify(r => r.GetExcludedUserIdsAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Universe_TradeUnitKeyOrderAndCasing_ShareOneCacheEntry()
    {
        SetupAccess(false);
        _repoMock.Setup(r => r.GetSnapshotUserIdsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(["CEgr"]);

        await _sut.GetUsersAsync(From, To, "TU1,TU2", null, CancellationToken.None);
        await _sut.GetUsersAsync(From, To, "tu2, tu1", null, CancellationToken.None);

        _repoMock.Verify(r => r.GetSnapshotUserIdsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Universe_DifferentTradeUnitKeys_AreCachedSeparately()
    {
        SetupAccess(false);
        _repoMock.Setup(r => r.GetSnapshotUserIdsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(["CEgr"]);

        await _sut.GetUsersAsync(From, To, "TU1", null, CancellationToken.None);
        await _sut.GetUsersAsync(From, To, "TU2", null, CancellationToken.None);

        _repoMock.Verify(r => r.GetSnapshotUserIdsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task AddingAnExclusion_InvalidatesTheCachedUniverse_Immediately()
    {
        SetupAccess(false);
        _repoMock.Setup(r => r.GetSnapshotUserIdsAsync(null, It.IsAny<CancellationToken>())).ReturnsAsync(["CEgr", "SFletcher"]);
        _repoMock.Setup(r => r.AddExcludedUserAsync("SFletcher", It.IsAny<string?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ExcludedUserRow(1, "SFletcher", "dev account", "CEgr", DateTime.UtcNow));

        var before = await _sut.GetUsersAsync(From, To, null, null, CancellationToken.None);
        Assert.Equal(2, before.Count);

        await _sut.AddExcludedUserAsync("SFletcher", "dev account", "CEgr", CancellationToken.None);
        // The list the universe subtracts now includes the new exclusion.
        _repoMock.Setup(r => r.GetExcludedUserIdsAsync(It.IsAny<CancellationToken>())).ReturnsAsync(["SFletcher"]);

        var after = await _sut.GetUsersAsync(From, To, null, null, CancellationToken.None);

        Assert.Single(after);
        Assert.Equal("CEgr", after[0].UserId);
    }

    // ── Summary ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Summary_WithAccessSet_CountsTheAccessUniverse()
    {
        SetupAccess(true, "CEgr", "admin-CEgr", "KHague");
        // From..To is entirely in the past, so the window is served by the rollups.
        _repoMock.Setup(r => r.GetActiveUserIdsFromRollupAsync(It.IsAny<DateOnly>(), It.IsAny<DateOnly>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(["CEgr"]);

        var summary = await _sut.GetSummaryAsync(From, To, tradeUnitKey: null, CancellationToken.None);

        Assert.Equal(3, summary.TotalUsers);   // the access group, not the whole directory
        Assert.Equal(1, summary.ActiveUsers);
        Assert.Equal(2, summary.NeedsAttentionCount);
    }

    [Fact]
    public async Task Summary_AvgLoginsPerWeek_IsPerUser_NotTheOrgTotal()
    {
        // Two users over a 14-day window: 20 logins and 8 logins.
        // Per user: (20/2 + 8/2) / 2 = 7 logins/week. The org total would be 14 — the old number.
        SetupAccess(true, "CEgr", "KHague", "NeverLoggedIn");
        var from = new DateOnly(2026, 7, 1);
        var to = new DateOnly(2026, 7, 14);
        _repoMock.Setup(r => r.GetSessionStatsFromRollupAsync(It.IsAny<DateOnly>(), It.IsAny<DateOnly>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new UserSessionStats("CEgr", 20, 10), new UserSessionStats("KHague", 8, 30)]);

        var summary = await _sut.GetSummaryAsync(from, to, tradeUnitKey: null, CancellationToken.None);

        Assert.Equal(7, summary.AvgLoginsPerWeek);
    }

    [Fact]
    public async Task Summary_AvgSessionMinutes_IsWeightedByLoginCount()
    {
        // 20 sessions × 10 min + 8 sessions × 30 min = 440 min over 28 sessions ≈ 15.7.
        // An unweighted mean of the two per-user averages would give 20.
        SetupAccess(true, "CEgr", "KHague");
        _repoMock.Setup(r => r.GetSessionStatsFromRollupAsync(It.IsAny<DateOnly>(), It.IsAny<DateOnly>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new UserSessionStats("CEgr", 20, 10), new UserSessionStats("KHague", 8, 30)]);

        var summary = await _sut.GetSummaryAsync(From, To, tradeUnitKey: null, CancellationToken.None);

        Assert.Equal(15.7, summary.AvgSessionMinutes);
    }

    [Fact]
    public async Task Summary_NoSessions_ReportsZerosRatherThanDividingByZero()
    {
        SetupAccess(true, "CEgr");

        var summary = await _sut.GetSummaryAsync(From, To, tradeUnitKey: null, CancellationToken.None);

        Assert.Equal(0, summary.AvgLoginsPerWeek);
        Assert.Equal(0, summary.AvgSessionMinutes);
        Assert.Equal(0, summary.AdoptionRate);
    }

    // ── Date window contract ─────────────────────────────────────────────────

    [Fact]
    public async Task Window_FromEqualsTo_CoversExactlyThatOneDay_InUtc()
    {
        SetupAccess(true, "CEgr");
        var day = new DateOnly(2026, 7, 15);
        DateTime? capturedFrom = null, capturedTo = null;
        _repoMock.Setup(r => r.GetLastActivityByUserAsync(It.IsAny<DateTime?>(), It.IsAny<DateTime?>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .Callback<DateTime?, DateTime?, IReadOnlyCollection<string>, CancellationToken>((f, t, _, _) => { capturedFrom = f; capturedTo = t; })
            .ReturnsAsync([]);

        await _sut.GetUsersAsync(day, day, tradeUnitKey: null, status: null, CancellationToken.None);

        Assert.Equal(new DateTime(2026, 7, 15, 0, 0, 0, DateTimeKind.Utc), capturedFrom);
        Assert.Equal(new DateTime(2026, 7, 16, 0, 0, 0, DateTimeKind.Utc), capturedTo);
    }

    [Fact]
    public async Task Window_InvertedRange_IsTreatedAsASingleDay_RatherThanReturningNothing()
    {
        SetupAccess(true, "CEgr");
        DateTime? capturedFrom = null, capturedTo = null;
        _repoMock.Setup(r => r.GetLastActivityByUserAsync(It.IsAny<DateTime?>(), It.IsAny<DateTime?>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .Callback<DateTime?, DateTime?, IReadOnlyCollection<string>, CancellationToken>((f, t, _, _) => { capturedFrom = f; capturedTo = t; })
            .ReturnsAsync([]);

        await _sut.GetUsersAsync(new DateOnly(2026, 7, 15), new DateOnly(2026, 7, 10), null, null, CancellationToken.None);

        Assert.Equal(new DateTime(2026, 7, 15, 0, 0, 0, DateTimeKind.Utc), capturedFrom);
        Assert.Equal(new DateTime(2026, 7, 16, 0, 0, 0, DateTimeKind.Utc), capturedTo);
    }

    [Fact]
    public async Task DailyActive_GapFillsEveryDayInTheWindow()
    {
        SetupAccess(true, "CEgr");
        _repoMock.Setup(r => r.GetDailyActiveCountsFromRollupAsync(It.IsAny<DateOnly>(), It.IsAny<DateOnly>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new DailyCount(new DateOnly(2026, 7, 2), 3)]);

        var series = await _sut.GetDailyActiveAsync(new DateOnly(2026, 7, 1), new DateOnly(2026, 7, 3), null, CancellationToken.None);

        Assert.Equal(3, series.Count);
        Assert.Equal(["2026-07-01", "2026-07-02", "2026-07-03"], series.Select(d => d.Date));
        Assert.Equal([0, 3, 0], series.Select(d => d.UniqueUserCount));
    }

    // ── Underused features ───────────────────────────────────────────────────

    [Fact]
    public async Task UnderusedFeatures_CountsDistinctUsers_AndRanksLeastUsedFirst()
    {
        SetupAccess(true, "CEgr", "KHague");
        _repoMock.Setup(r => r.GetFeatureUsersFromRollupAsync(It.IsAny<DateOnly>(), It.IsAny<DateOnly>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([
                new FeatureUser("customers", "CEgr"),
                new FeatureUser("customers", "KHague"),
                new FeatureUser("bidsheet", "CEgr")
            ]);

        var features = await _sut.GetUnderusedFeaturesAsync(From, To, null, CancellationToken.None);

        Assert.Equal(0, features[0].UniqueUsers);                                     // least used first
        Assert.Equal(2, features.Single(f => f.FeatureCode == "customers").UniqueUsers);
        Assert.Equal(1, features.Single(f => f.FeatureCode == "bidsheet").UniqueUsers);
        // A feature retired from the app must not linger here as a permanent zero.
        Assert.DoesNotContain(features, f => f.FeatureCode == "position-report");
    }

    [Fact]
    public async Task UnderusedFeatures_UserActiveInBothRollupAndToday_CountsOnce()
    {
        SetupAccess(true, "CEgr");
        _repoMock.Setup(r => r.GetFeatureUsersFromRollupAsync(It.IsAny<DateOnly>(), It.IsAny<DateOnly>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new FeatureUser("customers", "CEgr")]);
        _repoMock.Setup(r => r.GetFeatureUsersAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new FeatureUser("customers", "CEgr")]);

        // A window ending today spans both the rollups and the raw tables.
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var features = await _sut.GetUnderusedFeaturesAsync(today.AddDays(-7), today, null, CancellationToken.None);

        Assert.Equal(1, features.Single(f => f.FeatureCode == "customers").UniqueUsers);
    }

    // ── Excluded-users administration ────────────────────────────────────────

    [Fact]
    public async Task AddExcludedUser_NormalizesAFullUpnToItsShortName()
    {
        // Activity rows are keyed by short name, so an exclusion stored as a full UPN would never match.
        SetupAccess(true, "CEgr");
        string? captured = null;
        _repoMock.Setup(r => r.AddExcludedUserAsync(It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<string, string?, string, CancellationToken>((u, _, _, _) => captured = u)
            .ReturnsAsync((string u, string? reason, string by, CancellationToken _) => new ExcludedUserRow(1, u, reason, by, DateTime.UtcNow));

        await _sut.AddExcludedUserAsync("SFletcher@scoular.com", "dev account", "CEgr", CancellationToken.None);

        Assert.Equal("SFletcher", captured);
    }

    [Fact]
    public async Task AddExcludedUser_AlreadyExcluded_ReturnsNull()
    {
        SetupAccess(true, "CEgr");
        _repoMock.Setup(r => r.AddExcludedUserAsync(It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((ExcludedUserRow?)null);

        var result = await _sut.AddExcludedUserAsync("SFletcher", null, "CEgr", CancellationToken.None);

        Assert.Null(result);
    }

    [Fact]
    public async Task AddExcludedUser_RecordsTheAdminWhoAddedIt()
    {
        SetupAccess(true, "CEgr");
        string? capturedCreatedBy = null;
        _repoMock.Setup(r => r.AddExcludedUserAsync(It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<string, string?, string, CancellationToken>((_, _, by, _) => capturedCreatedBy = by)
            .ReturnsAsync(new ExcludedUserRow(1, "SFletcher", null, "CEgr", DateTime.UtcNow));

        await _sut.AddExcludedUserAsync("SFletcher", null, "CEgr", CancellationToken.None);

        Assert.Equal("CEgr", capturedCreatedBy);
    }

    [Fact]
    public async Task RemoveExcludedUser_MissingRow_ReturnsFalse()
    {
        _repoMock.Setup(r => r.RemoveExcludedUserAsync(It.IsAny<int>(), It.IsAny<CancellationToken>())).ReturnsAsync(false);

        Assert.False(await _sut.RemoveExcludedUserAsync(42, CancellationToken.None));
    }

    [Fact]
    public async Task GetExcludedUsers_ResolvesDisplayNames()
    {
        _repoMock.Setup(r => r.GetExcludedUsersAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync([new ExcludedUserRow(1, "CEgr", "dev account", "admin", new DateTime(2026, 7, 1))]);

        var rows = await _sut.GetExcludedUsersAsync(CancellationToken.None);

        Assert.Single(rows);
        Assert.Equal("Caden Egr", rows[0].DisplayName);
        Assert.Equal("dev account", rows[0].Reason);
    }
}
