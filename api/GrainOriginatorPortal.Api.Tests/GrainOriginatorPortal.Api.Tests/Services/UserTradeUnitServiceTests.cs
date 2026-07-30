// System namespaces
using System.Runtime.CompilerServices;

// Microsoft namespaces
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;

// Third-party namespaces
using Moq;

// Project namespaces
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

    // #5 (CWE-285): on an Entitlements DB outage the service must FAIL CLOSED (no trade units),
    // not fall open to the full org trade-unit list.
    [Fact]
    public async Task GetForCurrentUserAsync_WhenEntitlementsDbThrowsSql_FailsClosedReturnsEmpty()
    {
        // Arrange — simulate a SQL outage from the entitlements lookup.
        _entitlementsMock
            .Setup(e => e.GetByUserAsync("tuser", It.IsAny<CancellationToken>()))
            .ThrowsAsync(MakeSqlException());

        // Act
        var result = await _sut.GetForCurrentUserAsync(CancellationToken.None);

        // Assert — empty (fail closed), never a populated "All Trade Units" fallback.
        Assert.Empty(result);
    }

    // The location shown next to each code comes from MbpLocationSynonym (bare LocationId = code ->
    // DisplayName), NOT the entitlements Description. A matched code shows its DisplayName; an
    // unmatched code shows blank (just the code).
    [Fact]
    public async Task GetForCurrentUserAsync_SetsLocationFromMbpLocationSynonym_BlankWhenUnmatched()
    {
        // Arrange — two codes in one group; entitlements Description is intentionally a red herring.
        _entitlementsMock
            .Setup(e => e.GetByUserAsync("tuser", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<UserTradeUnitAccess>
            {
                new() { GroupName = "West", TradeUnitCode = "2115", Description = "stale-entitlements-desc" },
                new() { GroupName = "West", TradeUnitCode = "9999", Description = "stale-entitlements-desc" },
            });
        // Only 2115 resolves in the location master.
        _locationsMock
            .Setup(l => l.GetDisplayNamesByLocationIdsAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["2115"] = "Adrian, MO" });

        // Act
        var result = await _sut.GetForCurrentUserAsync(CancellationToken.None);

        // Assert — 2115 shows the DisplayName; 9999 (no master row) shows blank, not the entitlements text.
        var units = Assert.Single(result).TradeUnits;
        Assert.Equal("Adrian, MO", units.Single(u => u.Code == "2115").Description);
        Assert.True(string.IsNullOrEmpty(units.Single(u => u.Code == "9999").Description));
    }

    // SqlException has no public constructor; create an uninitialized instance so the catch filter
    // (ex is SqlException) is satisfied without a live SQL connection.
    private static SqlException MakeSqlException() =>
        (SqlException)RuntimeHelpers.GetUninitializedObject(typeof(SqlException));
}
