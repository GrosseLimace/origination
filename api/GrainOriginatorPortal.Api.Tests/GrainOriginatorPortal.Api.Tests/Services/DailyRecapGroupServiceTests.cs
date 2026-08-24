// Third-party namespaces
using Microsoft.Extensions.Logging;
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Security tests for recap-group create/update: members must be inside the caller's entitlement
/// overlap, person recipient emails are derived server-side (never trusted from the request body),
/// and the save fails closed when entitlements can't be read. Guards the Authorization + SQL-injection
/// (untrusted-email-into-query) findings.
/// </summary>
public class DailyRecapGroupServiceTests
{
    private readonly Mock<IDailyRecapGroupRepository> _repo = new();
    private readonly Mock<IEntitlementsRepository> _entitlements = new();
    private readonly Mock<IRequestContextService> _requestContext = new();
    private readonly DailyRecapGroupService _sut;

    public DailyRecapGroupServiceTests()
    {
        _requestContext.Setup(r => r.GetCurrentUser()).Returns("mgr@scoular.com");
        _requestContext.Setup(r => r.GetCurrentUserShortName()).Returns("mgr");

        // Caller "mgr" is entitled to TU1 (and group 7); "sam" shares TU1, "evil" does not.
        _entitlements.Setup(e => e.GetByUserAsync("mgr", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<UserTradeUnitPreference>
            {
                new() { UserId = "mgr", TradeUnitCode = "TU1", GroupId = 7 },
            });
        _entitlements.Setup(e => e.GetUsersByTradeUnitsAsync(
                It.Is<IReadOnlyCollection<string>>(c => c.Contains("TU1")), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<UserTradeUnitPreference>
            {
                new() { UserId = "mgr", TradeUnitCode = "TU1" },
                new() { UserId = "sam", TradeUnitCode = "TU1" },
            });

        _repo.Setup(r => r.AddAsync(It.IsAny<DailyRecapGroup>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((DailyRecapGroup g, CancellationToken _) => g);

        _sut = new DailyRecapGroupService(
            _repo.Object, _entitlements.Object, _requestContext.Object,
            Mock.Of<ILogger<DailyRecapGroupService>>());
    }

    private static RecapGroupRequest Request(params RecapGroupMemberRequest[] members) => new()
    {
        Name = "Daily",
        DeliveryMethod = "email",
        Members = members.ToList(),
    };

    private static RecapGroupMemberRequest Person(string id, string? email = null) =>
        new() { Type = "person", Id = id, Name = id, Email = email };

    // -------------------------------------------------------------------------
    // A group is a reusable list of people that can be @-mentioned in a note; the daily recap is one
    // opt-in behavior on it. Creation used to hardcode Enabled = true, so a group made purely to
    // @-mention started emailing everyone in it that evening.

    [Fact]
    public async Task CreateAsync_DefaultsTheDailyRecapOff()
    {
        DailyRecapGroup? captured = null;
        _repo.Setup(r => r.AddAsync(It.IsAny<DailyRecapGroup>(), It.IsAny<CancellationToken>()))
            .Callback<DailyRecapGroup, CancellationToken>((g, _) => captured = g)
            .ReturnsAsync((DailyRecapGroup g, CancellationToken _) => g);

        await _sut.CreateAsync(Request(Person("sam")), CancellationToken.None);

        Assert.False(captured!.Enabled);
    }

    [Fact]
    public async Task CreateAsync_HonoursAnExplicitDailyRecapOptIn()
    {
        DailyRecapGroup? captured = null;
        _repo.Setup(r => r.AddAsync(It.IsAny<DailyRecapGroup>(), It.IsAny<CancellationToken>()))
            .Callback<DailyRecapGroup, CancellationToken>((g, _) => captured = g)
            .ReturnsAsync((DailyRecapGroup g, CancellationToken _) => g);

        var request = Request(Person("sam")) with { Enabled = true };
        await _sut.CreateAsync(request, CancellationToken.None);

        Assert.True(captured!.Enabled);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task CreateAsync_PersonInOverlap_PersistsWithDerivedEmail()
    {
        DailyRecapGroup? captured = null;
        _repo.Setup(r => r.AddAsync(It.IsAny<DailyRecapGroup>(), It.IsAny<CancellationToken>()))
            .Callback<DailyRecapGroup, CancellationToken>((g, _) => captured = g)
            .ReturnsAsync((DailyRecapGroup g, CancellationToken _) => g);

        // Client supplies an attacker-controlled email — it must be ignored and derived from the id.
        await _sut.CreateAsync(Request(Person("sam", email: "attacker@evil.com")), CancellationToken.None);

        Assert.NotNull(captured);
        var member = Assert.Single(captured!.Members);
        Assert.Equal("sam", member.MemberId);
        Assert.Equal("sam@scoular.com", member.Email);   // derived, NOT the request's "attacker@evil.com"
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task CreateAsync_PersonOutsideOverlap_Throws403_AndDoesNotPersist()
    {
        await Assert.ThrowsAsync<ForbiddenException>(() =>
            _sut.CreateAsync(Request(Person("evil")), CancellationToken.None));

        _repo.Verify(r => r.AddAsync(It.IsAny<DailyRecapGroup>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task CreateAsync_TradeUnitMemberNotEntitled_Throws403()
    {
        var req = new RecapGroupRequest
        {
            Name = "Daily",
            DeliveryMethod = "email",
            Members = [new RecapGroupMemberRequest { Type = "trade-unit", Id = "TU9", Name = "TU9" }],
        };

        await Assert.ThrowsAsync<ForbiddenException>(() => _sut.CreateAsync(req, CancellationToken.None));
        _repo.Verify(r => r.AddAsync(It.IsAny<DailyRecapGroup>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task CreateAsync_TradeUnitGroupMemberEntitled_Persists()
    {
        var req = new RecapGroupRequest
        {
            Name = "Daily",
            DeliveryMethod = "email",
            Members = [new RecapGroupMemberRequest { Type = "trade-unit-group", Id = "7", Name = "My Group" }],
        };

        var result = await _sut.CreateAsync(req, CancellationToken.None);

        Assert.Single(result.Members);
        _repo.Verify(r => r.AddAsync(It.IsAny<DailyRecapGroup>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task CreateAsync_EntitlementsUnavailable_FailsClosed()
    {
        _entitlements.Setup(e => e.GetByUserAsync("mgr", It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("entitlements DB down"));

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            _sut.CreateAsync(Request(Person("sam")), CancellationToken.None));

        _repo.Verify(r => r.AddAsync(It.IsAny<DailyRecapGroup>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task CreateAsync_NoMembers_PersistsWithoutEntitlementLookup()
    {
        await _sut.CreateAsync(Request(), CancellationToken.None);

        _repo.Verify(r => r.AddAsync(It.IsAny<DailyRecapGroup>(), It.IsAny<CancellationToken>()), Times.Once);
        _entitlements.Verify(e => e.GetByUserAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
