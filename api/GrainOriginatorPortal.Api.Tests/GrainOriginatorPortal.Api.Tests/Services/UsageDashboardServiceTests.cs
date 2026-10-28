// Microsoft namespaces
using Microsoft.Extensions.Caching.Memory;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Covers the dashboard's user universe (Entra access set, narrowed by the manager filter, minus
/// exclusions, and how it is cached), the summary's averaging, the date-window contract, and the
/// excluded-users administration flow.
/// </summary>
public class UsageDashboardServiceTests
{
    private readonly Mock<IUsageRepository> _repoMock = new();
    private readonly Mock<IAppAccessService> _appAccessMock = new();
    private readonly Mock<IManagerDirectoryService> _managerDirectoryMock = new();
    private readonly UsageUniverseCacheState _cacheState = new();
    private readonly UsageDashboardService _sut;

    private static readonly DateOnly From = new(2026, 7, 1);
    private static readonly DateOnly To = new(2026, 7, 20);

    public UsageDashboardServiceTests()
    {
        // Loose defaults: no activity/session/click/note data — every user classifies as "Never".
        _repoMock.Setup(r => r.GetDisplayNamesAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new UserDisplayName("CEgr", "Caden Egr")]);
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
        _repoMock.Setup(r => r.GetLastActiveByUserAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        _sut = CreateSut();
    }

    /// <summary>Builds the service. There is no per-caller scoping any more — every caller may pick
    /// any manager and defaults to the whole org — so the only seeded list is the DB-backed
    /// dbo.UsageDashboardExcludedUsers via the repo mock.</summary>
    private UsageDashboardService CreateSut(params string[] excludeUsers)
    {
        _repoMock.Setup(r => r.GetExcludedUserIdsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(excludeUsers.ToList());
        // A real cache (not a mock) so the memoization tests exercise the actual code path. The app's
        // cache is registered with a SizeLimit; setting one here proves entries declare their size.
        var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 100 });
        return new UsageDashboardService(
            _repoMock.Object, _appAccessMock.Object, _managerDirectoryMock.Object, cache, _cacheState);
    }

    private void SetupSubtree(string managerId, params string[] subtreeUserIds)
    {
        _managerDirectoryMock
            .Setup(m => m.GetSubtreeUserIdsAsync(managerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HashSet<string>(subtreeUserIds, StringComparer.OrdinalIgnoreCase));
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

        var users = await _sut.GetUsersAsync(From, To, managerId: null, status: null, CancellationToken.None);

        Assert.Equal(2, users.Count);
        Assert.Contains(users, u => u.UserId == "CEgr");
        Assert.Contains(users, u => u.UserId == "admin-CEgr"); // access-only user appears
        // The snapshot is never consulted while the access set is available.
        _repoMock.Verify(r => r.GetSnapshotUserIdsAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task AllUsers_WithAccessSet_EntitledButNoAccessUser_IsHidden()
    {
        SetupAccess(true, "CEgr"); // JNoAccess is entitled (snapshot) but not in the group

        var users = await _sut.GetUsersAsync(From, To, managerId: null, status: null, CancellationToken.None);

        Assert.Single(users);
        Assert.DoesNotContain(users, u => u.UserId == "JNoAccess");
    }

    [Fact]
    public async Task AllUsers_AccessUnavailable_FallsOpenToSnapshot()
    {
        SetupAccess(false);
        _repoMock.Setup(r => r.GetSnapshotUserIdsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(["CEgr", "JNoAccess"]);

        var users = await _sut.GetUsersAsync(From, To, managerId: null, status: null, CancellationToken.None);

        // Pre-existing behavior: full entitlements directory.
        Assert.Equal(2, users.Count);
        Assert.Contains(users, u => u.UserId == "JNoAccess");
    }

    [Fact]
    public async Task DisplayName_FallsBackToEntraName_ForAccessOnlyUsers()
    {
        SetupAccess(true, "CEgr", "admin-CEgr"); // snapshot only knows CEgr's name

        var users = await _sut.GetUsersAsync(From, To, managerId: null, status: null, CancellationToken.None);

        Assert.Equal("Caden Egr", users.Single(u => u.UserId == "CEgr").DisplayName);          // snapshot name wins
        Assert.Equal("admin-CEgr (Entra)", users.Single(u => u.UserId == "admin-CEgr").DisplayName); // Entra fallback
    }

    [Fact]
    public async Task ExcludeUsers_DropsConfiguredItDevAccounts_CaseInsensitive_FromEveryView()
    {
        SetupAccess(true, "CEgr", "admin-CEgr", "KHague");
        // The exclusion rows use different casing than the access set to prove case-insensitive matching.
        var sut = CreateSut("cegr", "ADMIN-CEGR");

        var users = await sut.GetUsersAsync(From, To, managerId: null, status: null, CancellationToken.None);

        Assert.Single(users);
        Assert.Equal("KHague", users[0].UserId); // only the non-excluded originator remains
    }

    [Fact]
    public async Task ExcludeUsers_AppliesToManagerFilteredViews_Too()
    {
        SetupAccess(true, "CEgr", "SFletcher");
        SetupSubtree("MgrX", "CEgr", "SFletcher"); // both on the team and both have access
        var sut = CreateSut("SFletcher");

        var users = await sut.GetUsersAsync(From, To, managerId: "MgrX", status: null, CancellationToken.None);

        Assert.Single(users);
        Assert.Equal("CEgr", users[0].UserId); // SFletcher excluded even within a manager filter
    }

    // ── Universe caching ─────────────────────────────────────────────────────

    [Fact]
    public async Task Universe_IsResolvedOnce_AcrossMultipleEndpointCalls()
    {
        // A dashboard page load hits ~12 endpoints; each used to re-read the snapshot and the
        // exclusion table. They should now share one cached universe.
        SetupAccess(false);
        _repoMock.Setup(r => r.GetSnapshotUserIdsAsync(It.IsAny<CancellationToken>())).ReturnsAsync(["CEgr"]);

        await _sut.GetUsersAsync(From, To, null, null, CancellationToken.None);
        await _sut.GetSummaryAsync(From, To, null, CancellationToken.None);
        await _sut.GetDailyActiveAsync(From, To, null, CancellationToken.None);

        _repoMock.Verify(r => r.GetSnapshotUserIdsAsync(It.IsAny<CancellationToken>()), Times.Once);
        _repoMock.Verify(r => r.GetExcludedUserIdsAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task AddingAnExclusion_InvalidatesTheCachedUniverse_Immediately()
    {
        SetupAccess(false);
        _repoMock.Setup(r => r.GetSnapshotUserIdsAsync(It.IsAny<CancellationToken>())).ReturnsAsync(["CEgr", "SFletcher"]);
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

    // ── Manager filter ───────────────────────────────────────────────────────
    //
    // The manager filter is the dashboard's only narrowing, and it is honoured for EVERY caller:
    // there is no per-caller scoping (the former ViewAll list is gone), so a requested managerId
    // passes straight through and no managerId means the whole organisation. The filter lives in one
    // place — ResolveUserIdSetAsync, called by GetUserIdSetAsync, which every read funnels through —
    // so these tests pin the funnel rather than each endpoint.

    [Fact]
    public async Task ManagerFilter_IntersectsTheUniverse_WithTheSubtree()
    {
        SetupAccess(true, "CEgr", "AUser", "BUser");
        // The subtree also contains someone who isn't an app user — they must not appear.
        SetupSubtree("MgrX", "CEgr", "AUser", "NotAnAppUser");

        var users = await _sut.GetUsersAsync(From, To, managerId: "MgrX", status: null, CancellationToken.None);

        Assert.Equal(2, users.Count);
        Assert.Contains(users, u => u.UserId == "CEgr");
        Assert.Contains(users, u => u.UserId == "AUser");
    }

    [Fact]
    public async Task ManagerFilter_IncludesTheManagerThemselves_NotJustTheirReports()
    {
        SetupAccess(true, "MgrX", "MyReport");
        SetupSubtree("MgrX", "MgrX", "MyReport"); // the directory seeds the subtree with the manager

        var users = await _sut.GetUsersAsync(From, To, managerId: "MgrX", status: null, CancellationToken.None);

        Assert.Contains(users, u => u.UserId == "MgrX");
    }

    [Fact]
    public async Task ManagerFilter_ShowsOnlyReportsWhoActuallyHaveAppAccess()
    {
        // The requirement is the INTERSECTION: someone who reports to the manager but has no access
        // to the application is not an app user and has no adoption to measure, so they must not be listed.
        SetupAccess(true, "MgrX", "ReportWithAccess");
        SetupSubtree("MgrX", "MgrX", "ReportWithAccess", "ReportNoAccess");

        var users = await _sut.GetUsersAsync(From, To, managerId: "MgrX", status: null, CancellationToken.None);

        Assert.Equal(2, users.Count);
        Assert.DoesNotContain(users, u => u.UserId == "ReportNoAccess");
    }

    [Fact]
    public async Task NoManagerRequested_IsTheWholeOrg_ForEveryCaller()
    {
        // There is no self-scoping: a request without a manager is the whole organisation, not the
        // caller's own team. (The CLIENT defaults the dropdown to the signed-in user; the server
        // honours whatever it is sent.)
        SetupAccess(true, "CEgr", "MyReport", "SomeoneElse");

        var all = await _sut.GetUsersAsync(From, To, managerId: null, status: null, CancellationToken.None);

        Assert.Equal(3, all.Count);
        _managerDirectoryMock.Verify(
            m => m.GetSubtreeUserIdsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task RequestedManager_IsHonoured_ForEveryCaller()
    {
        // The requested manager is used as-is. Before, callers off the ViewAll list had the value
        // silently replaced with their own name; that rewrite no longer exists.
        SetupAccess(true, "CEgr", "MyReport", "SomeoneElse");
        SetupSubtree("OtherMgr", "SomeoneElse");

        var picked = await _sut.GetUsersAsync(From, To, managerId: "OtherMgr", status: null, CancellationToken.None);

        Assert.Single(picked);
        Assert.Equal("SomeoneElse", picked[0].UserId);
    }

    [Fact]
    public async Task EveryCaller_ReceivesTheManagerRoster()
    {
        var roster = new List<Api.Models.UsageManagerDto>
        {
            new() { UserId = "MgrX", DisplayName = "Manager X", DirectReports = 2, TotalReports = 5 },
        };
        _managerDirectoryMock
            .Setup(m => m.GetManagersAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(roster);

        var managers = await _sut.GetManagersAsync(CancellationToken.None);

        // No caller check in front of the roster any more — the dropdown is for everyone who can
        // open the dashboard, and the client needs the list up front to default it to the user.
        Assert.Same(roster, managers);
    }

    [Fact]
    public async Task ManagerFilter_UnknownManager_YieldsEmptyResults_NotAnError()
    {
        // GetSubtreeUserIdsAsync returns null for a non-manager, and null must not be read as
        // "no filter" — that would turn a stale bookmark into the whole org.
        SetupAccess(true, "CEgr");
        _managerDirectoryMock
            .Setup(m => m.GetSubtreeUserIdsAsync("NotAManager", It.IsAny<CancellationToken>()))
            .ReturnsAsync((HashSet<string>?)null);

        var users = await _sut.GetUsersAsync(From, To, managerId: "NotAManager", status: null, CancellationToken.None);

        Assert.Empty(users);
    }

    [Fact]
    public async Task ManagerFilter_SubtreeMatching_IsCaseInsensitive()
    {
        SetupAccess(true, "CEgr");
        SetupSubtree("MgrX", "cegr"); // subtree row cased differently than the access set

        var users = await _sut.GetUsersAsync(From, To, managerId: "MgrX", status: null, CancellationToken.None);

        Assert.Single(users);
    }

    [Fact]
    public async Task ManagerFilter_DifferentManagers_AreCachedSeparately_AndRepeatsHitTheCache()
    {
        SetupAccess(true, "CEgr", "AUser");
        SetupSubtree("MgrA", "CEgr");
        SetupSubtree("MgrB", "AUser");

        var a1 = await _sut.GetUsersAsync(From, To, "MgrA", null, CancellationToken.None);
        var b = await _sut.GetUsersAsync(From, To, "MgrB", null, CancellationToken.None);
        var a2 = await _sut.GetUsersAsync(From, To, "MgrA", null, CancellationToken.None);

        Assert.Equal("CEgr", a1.Single().UserId);   // managerId is part of the cache key…
        Assert.Equal("AUser", b.Single().UserId);   // …so the two managers don't share an entry
        Assert.Equal("CEgr", a2.Single().UserId);
        _managerDirectoryMock.Verify(m => m.GetSubtreeUserIdsAsync("MgrA", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ManagerFilter_ManagerIdCasing_SharesOneCacheEntry()
    {
        SetupAccess(true, "CEgr");
        SetupSubtree("MgrA", "CEgr");

        await _sut.GetUsersAsync(From, To, "MgrA", null, CancellationToken.None);
        await _sut.GetUsersAsync(From, To, "mgra", null, CancellationToken.None);

        // Only the first call resolved the subtree; the second was served from the cache.
        _managerDirectoryMock.Verify(
            m => m.GetSubtreeUserIdsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ManagerFilter_DirectoryOutage_PropagatesThe503_RatherThanFallingOpen()
    {
        SetupAccess(true, "CEgr");
        _managerDirectoryMock
            .Setup(m => m.GetSubtreeUserIdsAsync("MgrX", It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InfrastructureException("down", "ENTITLEMENTS_DB_UNAVAILABLE"));

        await Assert.ThrowsAsync<InfrastructureException>(
            () => _sut.GetUsersAsync(From, To, managerId: "MgrX", status: null, CancellationToken.None));
    }

    // ── Per-user drill-down gate ─────────────────────────────────────────────

    [Fact]
    public async Task UserDetail_RefusesSomeoneOutsideTheUniverse()
    {
        // The drill-down is gated on the same universe as the list: someone with no app access (or
        // an excluded account) is not reachable by URL even though their activity rows may exist.
        SetupAccess(true, "CEgr");

        var outside = await _sut.GetUserDetailAsync("NoAccessUser", From, To, CancellationToken.None);

        // Returning null (→ 404) rather than throwing is itself the evidence the gate fired: the
        // allowedIds check sits before any per-user repo read, and none of those reads are mocked in
        // this suite, so reaching them would surface as a NullReferenceException instead.
        Assert.Null(outside);
        _repoMock.Verify(
            r => r.GetSessionDurationsForUserAsync("NoAccessUser", It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task UserDetail_RefusesAnExcludedAccount()
    {
        SetupAccess(true, "CEgr", "SFletcher");
        var sut = CreateSut("SFletcher");

        Assert.Null(await sut.GetUserDetailAsync("SFletcher", From, To, CancellationToken.None));
    }

    // ── Summary ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Summary_WithAccessSet_CountsTheAccessUniverse()
    {
        SetupAccess(true, "CEgr", "admin-CEgr", "KHague");
        // CEgr was active today → Active tier; the other two have no recorded activity → need attention.
        _repoMock.Setup(r => r.GetLastActiveByUserAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new UserLastActivity("CEgr", DateTime.UtcNow)]);

        var summary = await _sut.GetSummaryAsync(From, To, managerId: null, CancellationToken.None);

        Assert.Equal(3, summary.TotalUsers);   // the access group, not the whole directory
        Assert.Equal(1, summary.ActiveUsers);
        Assert.Equal(2, summary.NeedsAttentionCount);   // Dormant + Never
    }

    [Fact]
    public async Task Users_StatusTiers_AreRecencyBased_TodayWeekAndBeyond()
    {
        SetupAccess(true, "Today", "ThisWeek", "LastMonth", "NoActivity");
        var now = DateTime.UtcNow;
        _repoMock.Setup(r => r.GetLastActiveByUserAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([
                new UserLastActivity("Today", now),
                new UserLastActivity("ThisWeek", now.AddDays(-3)),
                new UserLastActivity("LastMonth", now.AddDays(-30)),
            ]);

        var users = await _sut.GetUsersAsync(From, To, null, null, CancellationToken.None);
        var byId = users.ToDictionary(u => u.UserId);

        Assert.Equal("Active", byId["Today"].Status);        // used today
        Assert.Equal("Light Usage", byId["ThisWeek"].Status); // within the last week
        Assert.Equal("Dormant", byId["LastMonth"].Status);    // longer than a week
        Assert.Equal("Never", byId["NoActivity"].Status);     // no recorded activity, ever
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

        var summary = await _sut.GetSummaryAsync(from, to, managerId: null, CancellationToken.None);

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

        var summary = await _sut.GetSummaryAsync(From, To, managerId: null, CancellationToken.None);

        Assert.Equal(15.7, summary.AvgSessionMinutes);
    }

    [Fact]
    public async Task Summary_NoSessions_ReportsZerosRatherThanDividingByZero()
    {
        SetupAccess(true, "CEgr");

        var summary = await _sut.GetSummaryAsync(From, To, managerId: null, CancellationToken.None);

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
        _repoMock.Setup(r => r.GetContactCountsByUserAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .Callback<DateTime, DateTime, IReadOnlyCollection<string>, CancellationToken>((f, t, _, _) => { capturedFrom = f; capturedTo = t; })
            .ReturnsAsync([]);

        await _sut.GetUsersAsync(day, day, managerId: null, status: null, CancellationToken.None);

        Assert.Equal(new DateTime(2026, 7, 15, 0, 0, 0, DateTimeKind.Utc), capturedFrom);
        Assert.Equal(new DateTime(2026, 7, 16, 0, 0, 0, DateTimeKind.Utc), capturedTo);
    }

    [Fact]
    public async Task Window_InvertedRange_IsTreatedAsASingleDay_RatherThanReturningNothing()
    {
        SetupAccess(true, "CEgr");
        DateTime? capturedFrom = null, capturedTo = null;
        _repoMock.Setup(r => r.GetContactCountsByUserAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .Callback<DateTime, DateTime, IReadOnlyCollection<string>, CancellationToken>((f, t, _, _) => { capturedFrom = f; capturedTo = t; })
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
