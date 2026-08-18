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

    private static UserTradeUnitPreference Member(string userId, string tu, string? name = null) =>
        new() { UserId = userId, TradeUnitCode = tu, DisplayName = name ?? userId };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AssignAsync_CreatesOneCopyPerValidTarget_DropsOutOfTradeUnitTargets()
    {
        _entitlements
            .Setup(e => e.GetUsersByTradeUnitsAsync(It.Is<IReadOnlyCollection<string>>(c => c.Contains("TU1")), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<UserTradeUnitPreference> { Member("sam", "TU1"), Member("dana", "TU1") });

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
            .ReturnsAsync(new List<UserTradeUnitPreference> { Member("sam", "TU1") });

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
            .ReturnsAsync(new List<UserTradeUnitPreference>
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

    // ── Manager (admin) mutation scope ───────────────────────────────────────
    // Security: the admin "manage any" bypass on update/delete must be limited to lists whose trade
    // units overlap the caller's entitled trade units — never a blanket bypass over every list id.

    [Fact]
    public async Task UpdateAsync_Admin_ListInAllowedTradeUnits_AuthorizesManage()
    {
        _requestContext.Setup(r => r.IsAdmin()).Returns(true);
        _repo.Setup(r => r.GetByIdAsync(5, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new SavedList { Id = 5, TradeUnits = "TU1", CreatedBy = "other@x.com" });

        await _sut.UpdateAsync(5, "n", "q", "TU1", null, null, null, CancellationToken.None);

        _repo.Verify(r => r.UpdateAsync(5, "mgr@x.com", true, It.IsAny<string>(), It.IsAny<string>(),
            It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task UpdateAsync_Admin_ListOutsideAllowedTradeUnits_DeniesManage()
    {
        _requestContext.Setup(r => r.IsAdmin()).Returns(true);
        _repo.Setup(r => r.GetByIdAsync(5, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new SavedList { Id = 5, TradeUnits = "TU9", CreatedBy = "other@x.com" });

        await _sut.UpdateAsync(5, "n", "q", "TU1", null, null, null, CancellationToken.None);

        // canManageAny must be FALSE — the target list (TU9) is outside the caller's allowed {TU1}.
        _repo.Verify(r => r.UpdateAsync(5, "mgr@x.com", false, It.IsAny<string>(), It.IsAny<string>(),
            It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task UpdateAsync_NonAdmin_DeniesManage_WithoutLoadingTarget()
    {
        _requestContext.Setup(r => r.IsAdmin()).Returns(false);

        await _sut.UpdateAsync(5, "n", "q", "TU1", null, null, null, CancellationToken.None);

        _repo.Verify(r => r.UpdateAsync(5, "mgr@x.com", false, It.IsAny<string>(), It.IsAny<string>(),
            It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Once);
        _repo.Verify(r => r.GetByIdAsync(It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task DeleteAsync_Admin_ListOutsideAllowedTradeUnits_DeniesManage()
    {
        _requestContext.Setup(r => r.IsAdmin()).Returns(true);
        _repo.Setup(r => r.GetByIdAsync(5, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new SavedList { Id = 5, TradeUnits = "TU9" });

        await _sut.DeleteAsync(5, CancellationToken.None);

        _repo.Verify(r => r.DeleteAsync(5, "mgr@x.com", false, It.IsAny<CancellationToken>()), Times.Once);
    }
}
