// System namespaces
using System.Runtime.CompilerServices;

// Microsoft namespaces
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Covers <see cref="UserEntitlementService"/>'s outage behaviour as well as its happy path. The
/// class's own doc comment promises "fail closed, not silently allow", and a regression that
/// flipped the SqlException branch to fail OPEN would serve every trade unit's data to every user
/// during a DB blip — so each branch of that handler is pinned here rather than left to review.
/// </summary>
public class UserEntitlementServiceTests
{
    private readonly Mock<IEntitlementsRepository> _entitlementsMock = new();
    private readonly Mock<IRequestContextService> _requestContextMock = new();
    private readonly MemoryCache _sharedCache = new(new MemoryCacheOptions { SizeLimit = 128 });
    private readonly UserEntitlementService _sut;

    public UserEntitlementServiceTests()
    {
        _requestContextMock.Setup(r => r.GetCurrentUserShortName()).Returns("tuser");
        _sut = BuildService();
    }

    /// <summary>A service instance sharing this test's cache and mocks. The real service is
    /// registered scoped (one per request) while IMemoryCache is a singleton, so the
    /// last-known-good fallback only means anything across separate instances.</summary>
    private UserEntitlementService BuildService() => new(
        _entitlementsMock.Object,
        _requestContextMock.Object,
        _sharedCache,
        NullLogger<UserEntitlementService>.Instance);

    /// <summary>SqlException has no accessible constructor, so allocate one without running a
    /// constructor. The service only type-checks it (`ex is SqlException`), never reads members.</summary>
    private static SqlException NewSqlException() =>
        (SqlException)RuntimeHelpers.GetUninitializedObject(typeof(SqlException));

    private void SetupUserTradeUnits(params string[] codes) =>
        _entitlementsMock
            .Setup(e => e.GetTradeUnitCodesForUserAsync("tuser", It.IsAny<CancellationToken>()))
            .ReturnsAsync(codes.ToList());

    private void SetupUserLookupThrows(Exception ex) =>
        _entitlementsMock
            .Setup(e => e.GetTradeUnitCodesForUserAsync("tuser", It.IsAny<CancellationToken>()))
            .ThrowsAsync(ex);

    // -------------------------------------------------------------------------
    // GetAllowedTradeUnitCodesAsync
    // -------------------------------------------------------------------------

    [Fact]
    public async Task GetAllowedTradeUnitCodesAsync_ReturnsCodes_CaseInsensitively()
    {
        SetupUserTradeUnits("TU1", "TU2");

        var allowed = await _sut.GetAllowedTradeUnitCodesAsync(CancellationToken.None);

        Assert.Equal(2, allowed.Count);
        // The comparer matters: SQL's collation is case-insensitive, so a request for "tu1" must
        // match a stored "TU1" or entitled users get spurious denials.
        Assert.Contains("tu1", allowed);
        Assert.True(_sut.EntitlementsAvailable);
    }

    [Fact]
    public async Task GetAllowedTradeUnitCodesAsync_CachesForTheRequest_AndHitsTheRepositoryOnce()
    {
        SetupUserTradeUnits("TU1");

        await _sut.GetAllowedTradeUnitCodesAsync(CancellationToken.None);
        await _sut.GetAllowedTradeUnitCodesAsync(CancellationToken.None);

        _entitlementsMock.Verify(
            e => e.GetTradeUnitCodesForUserAsync("tuser", It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task GetAllowedTradeUnitCodesAsync_WhenIdentityMissing_ThrowsForbidden()
    {
        _requestContextMock.Setup(r => r.GetCurrentUserShortName()).Returns((string?)null);

        await Assert.ThrowsAsync<ForbiddenException>(
            () => BuildService().GetAllowedTradeUnitCodesAsync(CancellationToken.None));
    }

    // The fallback that keeps reads filtered during a transient outage.
    [Fact]
    public async Task GetAllowedTradeUnitCodesAsync_OnSqlOutage_WithWarmCache_ServesLastKnownGood()
    {
        // Arrange — one successful load populates the cross-request last-known-good cache.
        SetupUserTradeUnits("TU1", "TU2");
        await _sut.GetAllowedTradeUnitCodesAsync(CancellationToken.None);

        // A later request (new scoped instance, same singleton cache) hits a DB outage.
        SetupUserLookupThrows(NewSqlException());
        var duringOutage = BuildService();

        // Act
        var allowed = await duringOutage.GetAllowedTradeUnitCodesAsync(CancellationToken.None);

        // Assert — the previously-loaded set is served, so reads stay scoped to the user's own
        // trade units rather than falling open to all of them.
        Assert.Equal(["TU1", "TU2"], allowed.Order());
        // Entitlements are still considered usable: the filter has real data to work with, so
        // EnforceTradeUnitAccess must NOT 503 this request.
        Assert.True(duringOutage.EntitlementsAvailable);
    }

    // A SqlException wrapped in something else (e.g. by EF) must take the same path.
    [Fact]
    public async Task GetAllowedTradeUnitCodesAsync_OnWrappedSqlOutage_WithWarmCache_ServesLastKnownGood()
    {
        SetupUserTradeUnits("TU1");
        await _sut.GetAllowedTradeUnitCodesAsync(CancellationToken.None);

        SetupUserLookupThrows(new InvalidOperationException("wrapped", NewSqlException()));
        var duringOutage = BuildService();

        var allowed = await duringOutage.GetAllowedTradeUnitCodesAsync(CancellationToken.None);

        Assert.Equal(["TU1"], allowed);
        Assert.True(duringOutage.EntitlementsAvailable);
    }

    // The cold-outage path: no cache to fall back on, so deny everything.
    [Fact]
    public async Task GetAllowedTradeUnitCodesAsync_OnSqlOutage_WithNoCache_FailsClosedAndFlagsUnavailable()
    {
        SetupUserLookupThrows(NewSqlException());

        var allowed = await _sut.GetAllowedTradeUnitCodesAsync(CancellationToken.None);

        // Empty, NOT "all trade units" — this is the flip that would turn a DB blip into a
        // cross-trade-unit data leak.
        Assert.Empty(allowed);
        // And the flag drops so EnforceTradeUnitAccess returns 503 instead of serving an
        // unfiltered read that merely looks like "this user has no producers".
        Assert.False(_sut.EntitlementsAvailable);
    }

    // Only SQL failures get the fallback; anything else is a real bug and must surface.
    [Fact]
    public async Task GetAllowedTradeUnitCodesAsync_OnNonSqlFailure_Propagates()
    {
        SetupUserLookupThrows(new InvalidOperationException("boom"));

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => _sut.GetAllowedTradeUnitCodesAsync(CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    // ValidateTradeUnitsOrThrowAsync — the write-path gate
    // -------------------------------------------------------------------------

    [Fact]
    public async Task ValidateTradeUnitsOrThrowAsync_WhenAnyCodeIsNotEntitled_ThrowsForbidden()
    {
        SetupUserTradeUnits("TU1");

        var ex = await Assert.ThrowsAsync<ForbiddenException>(
            () => _sut.ValidateTradeUnitsOrThrowAsync(["TU1", "TU9"], CancellationToken.None));

        // The denied code belongs in the message so the caller knows which one to drop.
        Assert.Contains("TU9", ex.Message);
    }

    [Fact]
    public async Task ValidateTradeUnitsOrThrowAsync_WhenAllCodesEntitled_DoesNotThrow()
    {
        SetupUserTradeUnits("TU1", "TU2");

        await _sut.ValidateTradeUnitsOrThrowAsync(["TU1", "tu2"], CancellationToken.None);
    }

    [Fact]
    public async Task ValidateTradeUnitsOrThrowAsync_DuringColdOutage_DeniesEverything()
    {
        SetupUserLookupThrows(NewSqlException());

        // Fail-closed end to end: with no cache, a requested code is denied rather than waved
        // through because the allow-list came back empty.
        await Assert.ThrowsAsync<ForbiddenException>(
            () => _sut.ValidateTradeUnitsOrThrowAsync(["TU1"], CancellationToken.None));
    }

    public static TheoryData<string[]> NothingRequestedCases() =>
    [
        [],
        [""],
        ["   "],
    ];

    [Theory]
    [MemberData(nameof(NothingRequestedCases))]
    public async Task ValidateTradeUnitsOrThrowAsync_WithNothingRequested_ReturnsWithoutDenying(string[] requested)
    {
        SetupUserTradeUnits("TU1");

        // Documented early return: "no codes requested" is not an access violation. Callers that
        // need a code present must reject blank themselves (see BidSheetController.GetElevators).
        await _sut.ValidateTradeUnitsOrThrowAsync(requested, CancellationToken.None);
    }

    // -------------------------------------------------------------------------
    // ValidateCustomerAccessAsync — kept ready in case AR-02 is ever reversed
    // -------------------------------------------------------------------------

    // #4 (CWE-285): a customer with no trade-unit mapping must FAIL CLOSED (deny), not fall open.
    [Fact]
    public async Task ValidateCustomerAccessAsync_WhenCustomerHasNoTradeUnitMapping_ThrowsForbidden()
    {
        // Arrange — customer resolves to zero trade-unit codes (unmapped / not-yet-synced).
        _entitlementsMock
            .Setup(e => e.GetCustomerTradeUnitCodesAsync(123L, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<string>());

        // Act + Assert — access is denied rather than silently allowed.
        await Assert.ThrowsAsync<ForbiddenException>(
            () => _sut.ValidateCustomerAccessAsync(123L, CancellationToken.None));

        // It must deny BEFORE loading the caller's entitlements (true fail-closed).
        _entitlementsMock.Verify(
            e => e.GetTradeUnitCodesForUserAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task ValidateCustomerAccessAsync_WhenCallerSharesNoTradeUnitWithCustomer_ThrowsForbidden()
    {
        _entitlementsMock
            .Setup(e => e.GetCustomerTradeUnitCodesAsync(123L, It.IsAny<CancellationToken>()))
            .ReturnsAsync(["TU9"]);
        SetupUserTradeUnits("TU1");

        await Assert.ThrowsAsync<ForbiddenException>(
            () => _sut.ValidateCustomerAccessAsync(123L, CancellationToken.None));
    }

    [Fact]
    public async Task ValidateCustomerAccessAsync_WhenCallerSharesOneTradeUnit_DoesNotThrow()
    {
        // One overlapping trade unit is enough — a customer may sit in several.
        _entitlementsMock
            .Setup(e => e.GetCustomerTradeUnitCodesAsync(123L, It.IsAny<CancellationToken>()))
            .ReturnsAsync(["TU9", "TU1"]);
        SetupUserTradeUnits("TU1");

        await _sut.ValidateCustomerAccessAsync(123L, CancellationToken.None);
    }
}
