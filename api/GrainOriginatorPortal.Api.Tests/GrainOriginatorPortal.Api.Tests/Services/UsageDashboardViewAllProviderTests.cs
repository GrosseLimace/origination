// Microsoft namespaces
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Covers the whole-org viewer list now that it lives in dbo.UsageDashboardViewAllUsers rather than
/// the UsageDashboard:ViewAll config array: the read itself, the case-insensitive matching the
/// dashboard's user keys need, the caching that keeps a page load to one query, and — the one that
/// matters for access control — that a DB outage degrades to an EMPTY list rather than throwing or
/// handing anyone the whole organisation.
/// </summary>
public class UsageDashboardViewAllProviderTests
{
    private readonly Mock<IUsageRepository> _repoMock = new();

    private UsageDashboardViewAllProvider CreateSut()
        // A real cache (not a mock) so the caching tests exercise the actual code path. The app's
        // cache is registered with a SizeLimit; setting one here proves entries declare their size.
        => new(
            _repoMock.Object,
            new MemoryCache(new MemoryCacheOptions { SizeLimit = 100 }),
            NullLogger<UsageDashboardViewAllProvider>.Instance);

    [Fact]
    public async Task GetAsync_ReturnsTheRowsFromTheTable()
    {
        _repoMock.Setup(r => r.GetViewAllUserIdsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(["CEgr", "MPaulson"]);

        var result = await CreateSut().GetAsync(CancellationToken.None);

        Assert.Equal(2, result.Count);
        Assert.Contains("CEgr", result);
        Assert.Contains("MPaulson", result);
    }

    [Fact]
    public async Task GetAsync_MatchesShortNames_CaseInsensitively()
    {
        // Short names vary in casing at the source (e.g. "jpiittmann" / "JPiittmann"), and whoever
        // types the INSERT will not match the caller's token casing by luck.
        _repoMock.Setup(r => r.GetViewAllUserIdsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(["cegr"]);

        var result = await CreateSut().GetAsync(CancellationToken.None);

        Assert.Contains("CEgr", result);
    }

    [Fact]
    public async Task GetAsync_CachesTheList_SoOnePageLoadIsOneQuery()
    {
        _repoMock.Setup(r => r.GetViewAllUserIdsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(["CEgr"]);
        var sut = CreateSut();

        await sut.GetAsync(CancellationToken.None);
        await sut.GetAsync(CancellationToken.None);
        await sut.GetAsync(CancellationToken.None);

        _repoMock.Verify(r => r.GetViewAllUserIdsAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task GetAsync_DbUnavailable_FailsClosedToAnEmptyList()
    {
        // The whole point: empty means everyone drops to their own subtree. Returning the previous
        // list, or throwing in a way a caller might swallow, would turn a DB outage into either a
        // stale grant or an accidental whole-org view.
        _repoMock.Setup(r => r.GetViewAllUserIdsAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(MakeSqlException());

        var result = await CreateSut().GetAsync(CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetAsync_AfterAFailure_ShortCircuitsInsteadOfRetryingEveryEndpoint()
    {
        // One dashboard page load hits ~10 endpoints. A down DB should cost one connection timeout,
        // not ten.
        _repoMock.Setup(r => r.GetViewAllUserIdsAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(MakeSqlException());
        var sut = CreateSut();

        await sut.GetAsync(CancellationToken.None);
        await sut.GetAsync(CancellationToken.None);
        await sut.GetAsync(CancellationToken.None);

        _repoMock.Verify(r => r.GetViewAllUserIdsAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task GetAsync_EmptyTable_ReturnsEmpty_WhichScopesEveryone()
    {
        _repoMock.Setup(r => r.GetViewAllUserIdsAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);

        Assert.Empty(await CreateSut().GetAsync(CancellationToken.None));
    }

    /// <summary>SqlException has no public constructor; the provider catches broadly, so any
    /// exception exercises the same path.</summary>
    private static Exception MakeSqlException() => new InvalidOperationException("DB down");
}
