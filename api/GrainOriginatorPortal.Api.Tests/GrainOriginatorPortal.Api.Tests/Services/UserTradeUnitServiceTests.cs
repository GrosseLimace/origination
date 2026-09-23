// System namespaces
using System.Runtime.CompilerServices;

// Microsoft namespaces
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

public class UserTradeUnitServiceTests
{
    private readonly Mock<IEntitlementsRepository> _entitlementsMock = new();
    private readonly Mock<IMbpLocationSynonymRepository> _locationsMock = new();
    private readonly Mock<IRequestContextService> _requestContextMock = new();
    private readonly UserTradeUnitService _sut;

    public UserTradeUnitServiceTests()
    {
        _requestContextMock.Setup(r => r.GetCurrentUserShortName()).Returns("tuser");
        // Default: no location matches (empty map) so tests opting out get "just the code".
        _locationsMock
            .Setup(l => l.GetDisplayNamesByLocationIdsAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase));
        _sut = new UserTradeUnitService(
            _entitlementsMock.Object,
            _locationsMock.Object,
            _requestContextMock.Object,
            NullLogger<UserTradeUnitService>.Instance);
    }

    // #5 (CWE-285): on a TradeUnitPreferences DB outage the service must FAIL CLOSED — never fall open to
    // the full org trade-unit list. It surfaces as a 503 rather than an empty 200 because an empty 200
    // now means "this user has no assignments" and makes the client drop their saved selection.
    [Fact]
    public async Task GetForCurrentUserAsync_WhenEntitlementsDbThrowsSql_FailsClosedWith503()
    {
        // Arrange — simulate a SQL outage from the entitlements lookup.
        _entitlementsMock
            .Setup(e => e.GetByUserAsync("tuser", It.IsAny<CancellationToken>()))
            .ThrowsAsync(MakeSqlException());

        // Act
        var ex = await Assert.ThrowsAsync<InfrastructureException>(
            () => _sut.GetForCurrentUserAsync(CancellationToken.None));

        // Assert — distinguishable from "no assignments", and still never a populated fallback.
        Assert.Equal("ENTITLEMENTS_DB_UNAVAILABLE", ex.ErrorCode);
        Assert.IsType<SqlException>(ex.InnerException);
    }

    // A user with genuinely no assignments gets an empty 200 — the client treats that as "go set some
    // up in Trade Unit Preferences", which is only safe because outages take the 503 path above.
    [Fact]
    public async Task GetForCurrentUserAsync_WhenUserHasNoAssignments_ReturnsEmpty()
    {
        _entitlementsMock
            .Setup(e => e.GetByUserAsync("tuser", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<UserTradeUnitPreference>());

        var result = await _sut.GetForCurrentUserAsync(CancellationToken.None);

        Assert.Empty(result);
    }

    // The location next to each code resolves with a two-source fallback: the Trade Unit Preferences
    // Description first (the label users actually maintain in TUP), else the MbpLocationSynonym
    // DisplayName from the static MBPLOCSYN export, else blank. TUP must win where both exist —
    // MBP is a frozen 2026-07-30 snapshot and used to override live renames with stale names.
    [Fact]
    public async Task GetForCurrentUserAsync_ResolvesLocation_TupFirstThenMbpThenBlank()
    {
        // Arrange — three codes in one group covering all three fallback branches.
        _entitlementsMock
            .Setup(e => e.GetByUserAsync("tuser", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<UserTradeUnitPreference>
            {
                // In MBP master AND has a TUP description -> TUP wins (this is the renamed case).
                new() { GroupName = "West", TradeUnitCode = "2115", Description = "Adrian, MO" },
                // No TUP description but present in MBP master -> falls back to MBP.
                new() { GroupName = "West", TradeUnitCode = "9999", Description = null },
                // In neither -> blank.
                new() { GroupName = "West", TradeUnitCode = "0000", Description = null },
            });
        // 2115 and 9999 resolve in the location master; 2115's entry is the stale name.
        _locationsMock
            .Setup(l => l.GetDisplayNamesByLocationIdsAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["2115"] = "Stale Export Name",
                ["9999"] = "Pratt, KS",
            });

        // Act
        var result = await _sut.GetForCurrentUserAsync(CancellationToken.None);

        // Assert — TUP preferred, MBP fallback, else blank.
        var units = Assert.Single(result).TradeUnits;
        Assert.Equal("Adrian, MO", units.Single(u => u.Code == "2115").Description);   // TUP wins over MBP
        Assert.Equal("Pratt, KS", units.Single(u => u.Code == "9999").Description);    // MBP fallback
        Assert.True(string.IsNullOrEmpty(units.Single(u => u.Code == "0000").Description)); // neither -> blank
    }

    // SqlException has no public constructor; create an uninitialized instance so the catch filter
    // (ex is SqlException) is satisfied without a live SQL connection.
    private static SqlException MakeSqlException() =>
        (SqlException)RuntimeHelpers.GetUninitializedObject(typeof(SqlException));
}
