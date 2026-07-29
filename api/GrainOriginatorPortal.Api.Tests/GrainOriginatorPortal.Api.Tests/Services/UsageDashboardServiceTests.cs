// Microsoft namespaces
using Microsoft.Extensions.Configuration;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Covers the app-access integration in the dashboard's user universe: unfiltered views use the
/// Entra access set, trade-unit views intersect with it, and everything falls open to the
/// entitlements snapshot when the access set is unavailable.
/// </summary>
public class UsageDashboardServiceTests
{
    private readonly Mock<IUsageRepository> _repoMock = new();
    private readonly Mock<IAppAccessService> _appAccessMock = new();
    private readonly UsageDashboardService _sut;

    private static readonly DateTime From = new(2026, 7, 1);
    private static readonly DateTime To = new(2026, 7, 20);

    public UsageDashboardServiceTests()
    {
        // Loose defaults: no activity/session/click/note data — every user shows "Never Logged In".
        _repoMock.Setup(r => r.GetDisplayNamesAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new UserDisplayName("CEgr", "Caden Egr")]);
        _repoMock.Setup(r => r.GetLastActivityByUserAsync(It.IsAny<DateTime?>(), It.IsAny<DateTime?>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        _repoMock.Setup(r => r.GetSessionStatsByUserAsync(It.IsAny<DateTime?>(), It.IsAny<DateTime?>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        _repoMock.Setup(r => r.GetContactCountsByUserAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        _repoMock.Setup(r => r.GetNotesCreatedCountsByUserAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        _sut = CreateSut();
    }

    /// <summary>Builds the service with an optional UsageDashboard:ExcludeUsers config list.</summary>
    private UsageDashboardService CreateSut(params string[] excludeUsers)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(excludeUsers
                .Select((u, i) => new KeyValuePair<string, string?>($"UsageDashboard:ExcludeUsers:{i}", u)))
            .Build();
        return new UsageDashboardService(_repoMock.Object, _appAccessMock.Object, config);
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

    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AllUsers_WithAccessSet_EntitledButNoAccessUser_IsHidden()
    {
        SetupAccess(true, "CEgr"); // JNoAccess is entitled (snapshot) but not in the group

        var users = await _sut.GetUsersAsync(From, To, tradeUnitKey: null, status: null, CancellationToken.None);

        Assert.Single(users);
        Assert.DoesNotContain(users, u => u.UserId == "JNoAccess");
    }

    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    [Fact]
    public async Task DisplayName_FallsBackToEntraName_ForAccessOnlyUsers()
    {
        SetupAccess(true, "CEgr", "admin-CEgr"); // snapshot only knows CEgr's name

        var users = await _sut.GetUsersAsync(From, To, tradeUnitKey: null, status: null, CancellationToken.None);

        Assert.Equal("Caden Egr", users.Single(u => u.UserId == "CEgr").DisplayName);          // snapshot name wins
        Assert.Equal("admin-CEgr (Entra)", users.Single(u => u.UserId == "admin-CEgr").DisplayName); // Entra fallback
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ExcludeUsers_DropsConfiguredItDevAccounts_CaseInsensitive_FromEveryView()
    {
        SetupAccess(true, "CEgr", "admin-CEgr", "KHague");
        // Config uses different casing than the access set to prove case-insensitive matching.
        var sut = CreateSut("cegr", "ADMIN-CEGR");

        var users = await sut.GetUsersAsync(From, To, tradeUnitKey: null, status: null, CancellationToken.None);

        Assert.Single(users);
        Assert.Equal("KHague", users[0].UserId); // only the non-excluded originator remains
    }

    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Summary_WithAccessSet_CountsTheAccessUniverse()
    {
        SetupAccess(true, "CEgr", "admin-CEgr", "KHague");
        _repoMock.Setup(r => r.GetActiveUserIdsAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(["CEgr"]);
        _repoMock.Setup(r => r.GetSessionDurationsAsync(It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);

        var summary = await _sut.GetSummaryAsync(From, To, tradeUnitKey: null, CancellationToken.None);

        Assert.Equal(3, summary.TotalUsers);   // the access group, not the whole directory
        Assert.Equal(1, summary.ActiveUsers);
        Assert.Equal(2, summary.NeedsAttentionCount);
    }
}
