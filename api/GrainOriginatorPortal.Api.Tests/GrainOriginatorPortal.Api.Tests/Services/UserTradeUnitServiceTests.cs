// System namespaces
using System.Runtime.CompilerServices;

// Microsoft namespaces
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

public class UserTradeUnitServiceTests
{
    private readonly Mock<IEntitlementsRepository> _entitlementsMock = new();
    private readonly Mock<IRequestContextService> _requestContextMock = new();
    private readonly UserTradeUnitService _sut;

    public UserTradeUnitServiceTests()
    {
        _requestContextMock.Setup(r => r.GetCurrentUserShortName()).Returns("tuser");
        _sut = new UserTradeUnitService(
            _entitlementsMock.Object,
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

    // SqlException has no public constructor; create an uninitialized instance so the catch filter
    // (ex is SqlException) is satisfied without a live SQL connection.
    private static SqlException MakeSqlException() =>
        (SqlException)RuntimeHelpers.GetUninitializedObject(typeof(SqlException));
}
