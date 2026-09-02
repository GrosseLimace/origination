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

    // =========================================================================
    // Shared editing: any member of a group can edit it, not just its creator.
    //
    // The delta rule is what makes that workable. An editor whose entitlements are narrower than the
    // creator's must still be able to save a group containing members they could not have added
    // themselves — otherwise cross-trade-unit groups, the main reason to build one, become
    // un-editable by most of their members. Only ADDITIONS are entitlement-checked.
    // =========================================================================

    private const int GroupId = 5;
    private RecapGroupValues? _captured;
    private RecapGroupAccess? _capturedAccess;

    private static DailyRecapGroupMember Member(string type, string id, string? name = null, string? email = null) =>
        new() { MemberType = type, MemberId = id, MemberName = name ?? id, Email = email };

    /// <summary>A persisted group. Defaults to one created by someone else ("alice"), which is the
    /// interesting case — the caller "mgr" can only be editing it as a member.</summary>
    private static DailyRecapGroup Existing(string createdBy = "alice@scoular.com", params DailyRecapGroupMember[] members) => new()
    {
        Id = GroupId,
        Name = "Daily",
        DeliveryMethod = "email",
        CreatedBy = createdBy,
        Members = members.ToList(),
        CcEmails = [],
    };

    /// <summary>Makes <paramref name="existing"/> the group the caller sees at <see cref="GroupId"/>,
    /// and records the access + values the service hands the repository on save.</summary>
    private void ArrangeVisible(DailyRecapGroup existing)
    {
        _repo.Setup(r => r.GetVisibleByIdAsync(GroupId, It.IsAny<RecapGroupAccess>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(existing);
        _repo.Setup(r => r.UpdateAsync(GroupId, It.IsAny<RecapGroupAccess>(), It.IsAny<RecapGroupValues>(), It.IsAny<CancellationToken>()))
            .Callback<int, RecapGroupAccess, RecapGroupValues, CancellationToken>((_, access, values, _) =>
            {
                _capturedAccess = access;
                _captured = values;
            })
            .ReturnsAsync((int _, RecapGroupAccess _, RecapGroupValues v, CancellationToken _) => new DailyRecapGroup
            {
                Id = GroupId,
                Name = v.Name,
                DeliveryMethod = v.DeliveryMethod,
                TeamsChannelEmail = v.TeamsChannelEmail,
                CreatedBy = existing.CreatedBy,
                Members = v.Members,
                CcEmails = v.CcEmails,
            });
    }

    // ── Delta validation ─────────────────────────────────────────────────────
    [Fact]
    public async Task UpdateAsync_NonCreatorMember_KeepsPreExistingMemberOutsideEditorScope()
    {
        // "carol" is NOT in mgr's entitlement overlap, but she is already on alice's group. mgr edits
        // it as a member and the client echoes the full member list back. This must not 403.
        ArrangeVisible(Existing(members: Member("person", "carol", "Carol Jones", "carol@scoular.com")));

        var result = await _sut.UpdateAsync(GroupId, Request(Person("carol")) with { Name = "Renamed" }, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("Renamed", _captured!.Name);
        Assert.Equal("carol", Assert.Single(_captured.Members).MemberId);
        // No additions, so no people lookup was needed at all.
        _entitlements.Verify(e => e.GetUsersByTradeUnitsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task UpdateAsync_PreExistingMember_IgnoresRequestSuppliedNameAndEmail()
    {
        // The pass-through path must take identity + label from the DB row and re-derive the address.
        // Trusting either would let an editor relabel someone else's member, or slip an untrusted
        // recipient address past the check the create path already guards (M-025 / M-025a).
        ArrangeVisible(Existing(members: Member("person", "carol", "Carol Jones", "carol@scoular.com")));

        var spoofed = new RecapGroupMemberRequest { Type = "person", Id = "carol", Name = "Admin", Email = "attacker@evil.com" };
        await _sut.UpdateAsync(GroupId, Request(spoofed), CancellationToken.None);

        var member = Assert.Single(_captured!.Members);
        Assert.Equal("Carol Jones", member.MemberName);
        Assert.Equal("carol@scoular.com", member.Email);
    }

    [Fact]
    public async Task UpdateAsync_NewMemberOutsideScope_Throws403_AndDoesNotPersist()
    {
        ArrangeVisible(Existing(members: Member("person", "carol")));

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            _sut.UpdateAsync(GroupId, Request(Person("carol"), Person("evil")), CancellationToken.None));

        _repo.Verify(r => r.UpdateAsync(It.IsAny<int>(), It.IsAny<RecapGroupAccess>(), It.IsAny<RecapGroupValues>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task UpdateAsync_RemovingMemberOutsideScope_IsAllowed()
    {
        ArrangeVisible(Existing(members:
        [
            Member("person", "carol"),
            Member("person", "sam"),
        ]));

        await _sut.UpdateAsync(GroupId, Request(Person("sam")), CancellationToken.None);

        Assert.Equal("sam", Assert.Single(_captured!.Members).MemberId);
    }

    [Fact]
    public async Task UpdateAsync_MemberMatchIsCaseInsensitive_AndPersistsStoredCasing()
    {
        // Casing must not turn a pass-through into an addition (which would 403), and the stored
        // casing must win so it cannot drift across successive saves.
        ArrangeVisible(Existing(members: Member("person", "carol", "Carol Jones")));

        await _sut.UpdateAsync(GroupId, Request(Person("CAROL")), CancellationToken.None);

        Assert.Equal("carol", Assert.Single(_captured!.Members).MemberId);
    }

    [Fact]
    public async Task UpdateAsync_DuplicateMemberRowsInPayload_PersistOnce()
    {
        ArrangeVisible(Existing(members: Member("person", "carol")));

        await _sut.UpdateAsync(GroupId, Request(Person("carol"), Person("carol")), CancellationToken.None);

        Assert.Single(_captured!.Members);
    }

    [Fact]
    public async Task UpdateAsync_CreatorWhoLostAnEntitlement_CanStillRename()
    {
        // Regression guard for a bug that predates shared editing: re-validating every member meant a
        // creator whose entitlements shrank (or whose member changed trade units) could no longer
        // even rename their own group.
        ArrangeVisible(Existing("mgr@scoular.com", Member("person", "gone")));

        var result = await _sut.UpdateAsync(GroupId, Request(Person("gone")) with { Name = "Still Mine" }, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("Still Mine", _captured!.Name);
    }

    // ── Round-trips ──────────────────────────────────────────────────────────
    [Fact]
    public async Task UpdateAsync_RenameOnly_MakesExactlyOneEntitlementsCall()
    {
        // One fetch serves both the access decision and (unused) add validation.
        ArrangeVisible(Existing(members: Member("person", "carol")));

        await _sut.UpdateAsync(GroupId, Request(Person("carol")) with { Name = "Renamed" }, CancellationToken.None);

        _entitlements.Verify(e => e.GetByUserAsync("mgr", It.IsAny<CancellationToken>()), Times.Once);
        _entitlements.Verify(e => e.GetUsersByTradeUnitsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ── Fail modes: degrade, never widen ─────────────────────────────────────
    [Fact]
    public async Task UpdateAsync_EntitlementsUnavailable_DegradesToCreatorOnlyAccess()
    {
        // The single most important authorization assertion here: when entitlements cannot be read,
        // the access context handed to the repository must contain NO membership sets. Widening it
        // would make the visibility predicate match every group, letting anyone PUT any id.
        _entitlements.Setup(e => e.GetByUserAsync("mgr", It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("entitlements DB down"));
        ArrangeVisible(Existing("mgr@scoular.com", Member("person", "carol")));

        await _sut.UpdateAsync(GroupId, Request(Person("carol")) with { Name = "Renamed" }, CancellationToken.None);

        Assert.NotNull(_capturedAccess);
        Assert.Empty(_capturedAccess!.TradeUnitCodes);
        Assert.Empty(_capturedAccess.GroupIds);
        Assert.Equal("mgr@scoular.com", _capturedAccess.CallerUpn);
    }

    [Fact]
    public async Task UpdateAsync_EntitlementsUnavailable_RejectsAnAddition()
    {
        // Same outage, opposite half of the policy: a creator can still rename (above), but nobody
        // can add, because scope cannot be proved.
        _entitlements.Setup(e => e.GetByUserAsync("mgr", It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("entitlements DB down"));
        ArrangeVisible(Existing("mgr@scoular.com", Member("person", "carol")));

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            _sut.UpdateAsync(GroupId, Request(Person("carol"), Person("sam")), CancellationToken.None));
    }

    [Fact]
    public async Task UpdateAsync_GroupNotVisible_ReturnsNull_AndSkipsMemberValidation()
    {
        // Authorize BEFORE validating, so a caller who cannot see the group learns nothing about
        // whose entitlements its members fall under.
        var result = await _sut.UpdateAsync(GroupId, Request(Person("evil")), CancellationToken.None);

        Assert.Null(result);
        _entitlements.Verify(e => e.GetUsersByTradeUnitsAsync(It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()), Times.Never);
        _repo.Verify(r => r.UpdateAsync(It.IsAny<int>(), It.IsAny<RecapGroupAccess>(), It.IsAny<RecapGroupValues>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task UpdateAsync_NotVisibleWhileEntitlementsDown_Throws503NotNull()
    {
        // A degraded context only matches groups the caller created, so a member's legitimate edit
        // would look like a 404. Say "try again" instead of lying about existence.
        _entitlements.Setup(e => e.GetByUserAsync("mgr", It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("entitlements DB down"));

        await Assert.ThrowsAsync<InfrastructureException>(() =>
            _sut.UpdateAsync(GroupId, Request(Person("carol")), CancellationToken.None));
    }

    // ── IsOwner / CanEdit ────────────────────────────────────────────────────
    [Fact]
    public async Task UpdateAsync_MemberEditor_ReportsCanEditButNotOwner()
    {
        // IsOwner drives the Delete button. Reporting it as true after a member's own edit would
        // render a button that 403s on click.
        ArrangeVisible(Existing(members: Member("person", "carol")));

        var result = await _sut.UpdateAsync(GroupId, Request(Person("carol")), CancellationToken.None);

        Assert.False(result!.IsOwner);
        Assert.True(result.CanEdit);
        Assert.Equal("alice@scoular.com", result.CreatedBy);
    }

    [Fact]
    public async Task UpdateAsync_Creator_ReportsOwner_EvenWhenUpnCasingDiffers()
    {
        // The SQL predicate matches under a case-insensitive collation, so the C# flag must too.
        ArrangeVisible(Existing("MGR@Scoular.com", Member("person", "carol")));

        var result = await _sut.UpdateAsync(GroupId, Request(Person("carol")), CancellationToken.None);

        Assert.True(result!.IsOwner);
    }

    // ── SetEnabled: a member can start or stop the daily send ────────────────
    [Fact]
    public async Task SetEnabledAsync_NonCreatorMember_Succeeds_AndReportsIsOwnerFalse()
    {
        _repo.Setup(r => r.SetEnabledAsync(GroupId, It.IsAny<RecapGroupAccess>(), true, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DailyRecapGroup { Id = GroupId, Name = "Daily", CreatedBy = "alice@scoular.com", Enabled = true });

        var result = await _sut.SetEnabledAsync(GroupId, true, CancellationToken.None);

        Assert.True(result!.Enabled);
        Assert.False(result.IsOwner);
        Assert.True(result.CanEdit);
    }

    [Fact]
    public async Task SetEnabledAsync_NotVisible_ReturnsNull()
    {
        Assert.Null(await _sut.SetEnabledAsync(GroupId, true, CancellationToken.None));
    }

    // ── Delete stays creator-only ────────────────────────────────────────────
    [Fact]
    public async Task DeleteAsync_NonCreator_Throws403_AndNeverCallsRepositoryDelete()
    {
        // This used to be a silent no-op: a member's DELETE returned 204 and the controller logged an
        // AUDIT_DELETE for a delete that never happened.
        _repo.Setup(r => r.GetByIdAsync(GroupId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Existing(members: Member("person", "mgr")));

        await Assert.ThrowsAsync<ForbiddenException>(() => _sut.DeleteAsync(GroupId, CancellationToken.None));

        _repo.Verify(r => r.DeleteAsync(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task DeleteAsync_MissingGroup_Throws404()
    {
        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteAsync(GroupId, CancellationToken.None));
    }

    [Fact]
    public async Task DeleteAsync_Creator_DeletesAndMakesNoEntitlementsCall()
    {
        _repo.Setup(r => r.GetByIdAsync(GroupId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Existing("mgr@scoular.com"));
        _repo.Setup(r => r.DeleteAsync(GroupId, "mgr@scoular.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        await _sut.DeleteAsync(GroupId, CancellationToken.None);

        _repo.Verify(r => r.DeleteAsync(GroupId, "mgr@scoular.com", It.IsAny<CancellationToken>()), Times.Once);
        _entitlements.Verify(e => e.GetByUserAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task DeleteAsync_RowVanishesBetweenReadAndDelete_Throws404()
    {
        // Keeps the controller audit line unreachable unless a row really went away.
        _repo.Setup(r => r.GetByIdAsync(GroupId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Existing("mgr@scoular.com"));
        _repo.Setup(r => r.DeleteAsync(GroupId, "mgr@scoular.com", It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        await Assert.ThrowsAsync<NotFoundException>(() => _sut.DeleteAsync(GroupId, CancellationToken.None));
    }

    // ── The list ─────────────────────────────────────────────────────────────
    [Fact]
    public async Task GetAllAsync_MarksEveryVisibleGroupEditable_ButOnlyOwnedOnesOwned()
    {
        _repo.Setup(r => r.GetVisibleAsync(It.IsAny<RecapGroupAccess>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(
            [
                new DailyRecapGroup { Id = 1, Name = "Mine", CreatedBy = "mgr@scoular.com" },
                new DailyRecapGroup { Id = 2, Name = "Theirs", CreatedBy = "alice@scoular.com" },
            ]);

        var result = await _sut.GetAllAsync(CancellationToken.None);

        Assert.All(result, g => Assert.True(g.CanEdit));
        Assert.True(result.Single(g => g.Id == 1).IsOwner);
        Assert.False(result.Single(g => g.Id == 2).IsOwner);
    }
}
