// Microsoft namespaces
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

public class UserEntitlementServiceTests
{
    private readonly Mock<IEntitlementsRepository> _entitlementsMock = new();
    private readonly Mock<IRequestContextService> _requestContextMock = new();
    private readonly UserEntitlementService _sut;

    public UserEntitlementServiceTests()
    {
        _requestContextMock.Setup(r => r.GetCurrentUserShortName()).Returns("tuser");
        _sut = new UserEntitlementService(
            _entitlementsMock.Object,
            _requestContextMock.Object,
            new MemoryCache(new MemoryCacheOptions()),
            NullLogger<UserEntitlementService>.Instance);
    }

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
}
