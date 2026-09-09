// System namespaces
using System.Runtime.CompilerServices;

// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Covers the manager directory's subtree math (materialized-path prefix over vw_UserManagerLookup),
/// the managers roster, the in-memory caching, and the fail-closed 503 on a TradeUnitPreferences
/// outage.
/// </summary>
public class ManagerDirectoryServiceTests
{
    private readonly Mock<IUsageRepository> _repoMock = new();
    private readonly ManagerDirectoryService _sut;

    public ManagerDirectoryServiceTests()
    {
        // Mirrors the dev data shape: CEO "01", a mid-level manager "01.01" with a nested team,
        // a sibling branch "01.02" that must never leak into "01.01"'s subtree, and an orphan
        // with a null HierID hanging off MgrMid by ManagerUserId only.
        SetupRows(
            Row("CEO", "Paul Maass", "01", null, null, null),
            Row("MgrMid", "Kyle Canning", "01.01", "CEO", "Paul Maass", "01"),
            Row("Report1", "Blake Schmidt", "01.01.01", "MgrMid", "Kyle Canning", "01.01"),
            Row("MgrLeaf", "Mike Hartquist", "01.01.02", "MgrMid", "Kyle Canning", "01.01"),
            Row("Deep1", "Grace Schaefer", "01.01.02.01", "MgrLeaf", "Mike Hartquist", "01.01.02"),
            Row("Sibling", "Amy Patterson", "01.02", "CEO", "Paul Maass", "01"),
            Row("SiblingKid", "Steven Moore", "01.02.01", "Sibling", "Amy Patterson", "01.02"),
            Row("NoHier", "No HierId", null, "MgrMid", "Kyle Canning", "01.01"));
        _sut = CreateSut();
    }

    private static UserManagerRow Row(string userId, string name, string? hier,
        string? mgrId, string? mgrName, string? mgrHier)
        => new(userId, name, hier, mgrId, mgrName, mgrHier);

    private void SetupRows(params UserManagerRow[] rows)
        => _repoMock.Setup(r => r.GetUserManagerLookupAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(rows.ToList());

    /// <summary>A real cache (not a mock) so the memoization tests exercise the actual code path;
    /// the SizeLimit proves entries declare their size like the app's shared cache requires.</summary>
    private ManagerDirectoryService CreateSut()
        => new(_repoMock.Object,
            new MemoryCache(new MemoryCacheOptions { SizeLimit = 100 }),
            NullLogger<ManagerDirectoryService>.Instance);

    // ── Subtree ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Subtree_IncludesManager_DirectReports_AndDeeperLevels()
    {
        var set = await _sut.GetSubtreeUserIdsAsync("MgrMid", CancellationToken.None);

        Assert.NotNull(set);
        Assert.Contains("MgrMid", set);   // the manager themself
        Assert.Contains("Report1", set);  // direct report
        Assert.Contains("MgrLeaf", set);  // direct report who is also a manager
        Assert.Contains("Deep1", set);    // report-of-report
        Assert.Contains("NoHier", set);   // direct report with no HierID still counts
        Assert.Equal(5, set.Count);
    }

    [Fact]
    public async Task Subtree_ExcludesSiblingsAndAncestors()
    {
        var set = await _sut.GetSubtreeUserIdsAsync("MgrMid", CancellationToken.None);

        Assert.NotNull(set);
        Assert.DoesNotContain("CEO", set);
        Assert.DoesNotContain("Sibling", set);
        Assert.DoesNotContain("SiblingKid", set);
    }

    [Fact]
    public async Task Subtree_PrefixMatchRequiresTheDot_SoDot1DoesNotCaptureDot11()
    {
        // "01.1" must not swallow "01.11.x" — the trailing dot in the prefix guards this.
        SetupRows(
            Row("MgrA", "Manager A", "01.1", "CEO", "c", "01"),
            Row("AKid", "A's report", "01.1.01", "MgrA", "Manager A", "01.1"),
            Row("MgrB", "Manager B", "01.11", "CEO", "c", "01"),
            Row("BKid", "B's report", "01.11.01", "MgrB", "Manager B", "01.11"));
        var sut = CreateSut();

        var set = await sut.GetSubtreeUserIdsAsync("MgrA", CancellationToken.None);

        Assert.NotNull(set);
        Assert.Equal(new HashSet<string>(["MgrA", "AKid"], StringComparer.OrdinalIgnoreCase), set);
    }

    [Fact]
    public async Task Subtree_ManagerIdLookup_IsCaseInsensitive()
    {
        var set = await _sut.GetSubtreeUserIdsAsync("mgrmid", CancellationToken.None);

        Assert.NotNull(set);
        Assert.Contains("Report1", set);
    }

    [Fact]
    public async Task Subtree_UnknownManager_ReturnsNull()
    {
        Assert.Null(await _sut.GetSubtreeUserIdsAsync("NotAManager", CancellationToken.None));
    }

    [Fact]
    public async Task Subtree_NonManagerUser_ReturnsNull()
    {
        // Report1 exists in the directory but nobody reports to them.
        Assert.Null(await _sut.GetSubtreeUserIdsAsync("Report1", CancellationToken.None));
    }

    // ── Managers roster ──────────────────────────────────────────────────────

    [Fact]
    public async Task Managers_AreDistinct_NameSorted_WithDirectAndTotalCounts()
    {
        var managers = await _sut.GetManagersAsync(CancellationToken.None);

        // Derived from ManagerUserId columns: CEO, MgrMid, MgrLeaf, Sibling.
        Assert.Equal(4, managers.Count);
        Assert.Equal(["Amy Patterson", "Kyle Canning", "Mike Hartquist", "Paul Maass"],
            managers.Select(m => m.DisplayName));

        var mid = managers.Single(m => m.UserId == "MgrMid");
        Assert.Equal(3, mid.DirectReports);  // Report1, MgrLeaf, NoHier
        Assert.Equal(3, mid.TotalReports);   // Report1, MgrLeaf, Deep1 (NoHier has no HierID path)

        var ceo = managers.Single(m => m.UserId == "CEO");
        Assert.Equal(2, ceo.DirectReports);  // MgrMid, Sibling
        Assert.Equal(6, ceo.TotalReports);   // everyone under "01." (NoHier excluded — no path)
    }

    [Fact]
    public async Task Managers_UsersWhoManageNobody_AreAbsent()
    {
        var managers = await _sut.GetManagersAsync(CancellationToken.None);

        Assert.DoesNotContain(managers, m => m.UserId == "Report1");
        Assert.DoesNotContain(managers, m => m.UserId == "Deep1");
    }

    // ── Caching ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Directory_IsReadOnce_AcrossCalls()
    {
        await _sut.GetManagersAsync(CancellationToken.None);
        await _sut.GetSubtreeUserIdsAsync("MgrMid", CancellationToken.None);
        await _sut.GetSubtreeUserIdsAsync("CEO", CancellationToken.None);

        _repoMock.Verify(r => r.GetUserManagerLookupAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    // ── Outage behavior ──────────────────────────────────────────────────────

    [Fact]
    public async Task SqlOutage_FailsClosed_As503WithEntitlementsErrorCode()
    {
        _repoMock.Setup(r => r.GetUserManagerLookupAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(MakeSqlException());
        var sut = CreateSut();

        var ex = await Assert.ThrowsAsync<InfrastructureException>(
            () => sut.GetSubtreeUserIdsAsync("MgrMid", CancellationToken.None));

        Assert.Equal("ENTITLEMENTS_DB_UNAVAILABLE", ex.ErrorCode);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, ex.HttpStatusCode);
    }

    [Fact]
    public async Task SqlOutage_IsRemembered_SoOnePageLoadCostsOneTimeout()
    {
        _repoMock.Setup(r => r.GetUserManagerLookupAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(MakeSqlException());
        var sut = CreateSut();

        await Assert.ThrowsAsync<InfrastructureException>(() => sut.GetManagersAsync(CancellationToken.None));
        await Assert.ThrowsAsync<InfrastructureException>(() => sut.GetManagersAsync(CancellationToken.None));

        // The second call short-circuits on the failure cache entry instead of re-querying.
        _repoMock.Verify(r => r.GetUserManagerLookupAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    // SqlException has no public constructor; create an uninitialized instance so the catch filter
    // (ex is SqlException) is satisfied without a live SQL connection.
    private static SqlException MakeSqlException() =>
        (SqlException)RuntimeHelpers.GetUninitializedObject(typeof(SqlException));
}
