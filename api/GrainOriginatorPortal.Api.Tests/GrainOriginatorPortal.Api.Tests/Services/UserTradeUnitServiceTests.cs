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

    // The location next to each code resolves with a two-source fallback: MbpLocationSynonym
    // DisplayName first, else the entitlements Description, else blank.
    [Fact]
    public async Task GetForCurrentUserAsync_ResolvesLocation_MbpFirstThenEntitlementsThenBlank()
    {
        // Arrange — three codes in one group covering all three fallback branches.
        _entitlementsMock
            .Setup(e => e.GetByUserAsync("tuser", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<UserTradeUnitPreference>
            {
                // In MBP master AND has an entitlements desc -> MBP wins.
                new() { GroupName = "West", TradeUnitCode = "2115", Description = "Entitlements Adrian" },
                // NOT in MBP master but has an entitlements desc -> falls back to entitlements.
                new() { GroupName = "West", TradeUnitCode = "9999", Description = "Pratt, KS" },
                // In neither -> blank.
                new() { GroupName = "West", TradeUnitCode = "0000", Description = null },
            });
        // Only 2115 resolves in the location master.
        _locationsMock
            .Setup(l => l.GetDisplayNamesByLocationIdsAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["2115"] = "Adrian, MO" });

        // Act
        var result = await _sut.GetForCurrentUserAsync(CancellationToken.None);

        // Assert — MBP preferred, entitlements fallback, else blank.
        var units = Assert.Single(result).TradeUnits;
        Assert.Equal("Adrian, MO", units.Single(u => u.Code == "2115").Description);   // MBP wins over entitlements
        Assert.Equal("Pratt, KS", units.Single(u => u.Code == "9999").Description);    // entitlements fallback
        Assert.True(string.IsNullOrEmpty(units.Single(u => u.Code == "0000").Description)); // neither -> blank
    }

    // SqlException has no public constructor; create an uninitialized instance so the catch filter
    // (ex is SqlException) is satisfied without a live SQL connection.
    private static SqlException MakeSqlException() =>
        (SqlException)RuntimeHelpers.GetUninitializedObject(typeof(SqlException));
}
