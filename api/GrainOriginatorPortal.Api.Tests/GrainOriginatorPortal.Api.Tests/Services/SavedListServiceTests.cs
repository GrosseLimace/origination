// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

public class SavedListServiceTests
{
    private readonly Mock<ISavedListRepository> _repo = new();
    private readonly Mock<IEntitlementsRepository> _entitlements = new();
    private readonly Mock<IDisplayNameLookupRepository> _displayNames = new();
    private readonly Mock<IUserEntitlementService> _entitlementService = new();
    private readonly Mock<IRequestContextService> _requestContext = new();
    private readonly SavedListService _sut;

    public SavedListServiceTests()
    {
        _requestContext.Setup(r => r.GetCurrentUser()).Returns("mgr@x.com");
        _requestContext.Setup(r => r.GetCurrentUserShortName()).Returns("mgr");
        _displayNames
            .Setup(d => d.ResolveAsync(It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        _entitlementService
            .Setup(e => e.GetAllowedTradeUnitCodesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "TU1" });

        _sut = new SavedListService(_repo.Object, _entitlements.Object, _displayNames.Object,
            _entitlementService.Object, _requestContext.Object);
    }

    private static UserTradeUnitAccess Member(string userId, string tu, string? name = null) =>
        new() { UserId = userId, TradeUnitCode = tu, DisplayName = name ?? userId };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AssignAsync_CreatesOneCopyPerValidTarget_DropsOutOfTradeUnitTargets()
    {
        _entitlements
            .Setup(e => e.GetUsersByTradeUnitsAsync(It.Is<IReadOnlyCollection<string>>(c => c.Contains("TU1")), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<UserTradeUnitAccess> { Member("sam", "TU1"), Member("dana", "TU1") });

        List<SavedList>? captured = null;
        _repo.Setup(r => r.AddRangeAsync(It.IsAny<IEnumerable<SavedList>>(), It.IsAny<CancellationToken>()))
            .Callback<IEnumerable<SavedList>, CancellationToken>((lists, _) => captured = lists.ToList())
            .Returns(Task.CompletedTask);

        // "evil" is not a member of TU1 → must be dropped
        var result = await _sut.AssignAsync(new[] { "sam", "dana", "evil" }, "Corn", "corn",
            "TU1", null, null, null, CancellationToken.None);

        Assert.NotNull(captured);
        // Stored as full UPN (short picker id + the manager's tenant domain).
        Assert.Equal(new[] { "sam@x.com", "dana@x.com" }, captured!.Select(c => c.AssignedTo).ToArray());
        Assert.All(captured, c => Assert.Equal("mgr@x.com", c.CreatedBy)); // creator = manager
        Assert.Equal(2, result.Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AssignAsync_NoValidTargets_DoesNotPersist()
    {
        _entitlements
            .Setup(e => e.GetUsersByTradeUnitsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<UserTradeUnitAccess> { Member("sam", "TU1") });

        var result = await _sut.AssignAsync(new[] { "evil" }, "Corn", "corn", "TU1", null, null, null, CancellationToken.None);

        Assert.Empty(result);
        _repo.Verify(r => r.AddRangeAsync(It.IsAny<IEnumerable<SavedList>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetTeamMembersAsync_ExcludesCaller_AndDeduplicates()
    {
        _entitlements
            .Setup(e => e.GetUsersByTradeUnitsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<UserTradeUnitAccess>
            {
                Member("sam", "TU1", "Sam Smith"),
                Member("sam", "TU2", "Sam Smith"), // duplicate across TUs → one entry
                Member("mgr", "TU1", "Manager"),    // the caller → excluded
            });

        var result = await _sut.GetTeamMembersAsync("TU1", CancellationToken.None);

        var member = Assert.Single(result);
        Assert.Equal("sam", member.UserId);
        Assert.Equal("Sam Smith", member.DisplayName);
    }
}
