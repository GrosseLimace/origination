// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Exercises the access predicate shared by every read and write in
/// <see cref="DailyRecapGroupRepository"/> against an InMemory database. Edit rights equal
/// visibility, so the same predicate that decides what the Manage Groups page lists also decides who
/// may update or toggle — these tests pin that a member (not just the creator) gets through, that a
/// stranger does not, and that DELETE stays creator-only.
///
/// Deliberately NOT tested here: case-insensitive matching of CreatedBy / MemberId. The InMemory
/// provider compares ordinally while Azure SQL uses a case-insensitive collation, so an assertion
/// either way would lie about production. All case-insensitivity lives in the service, with an
/// explicit StringComparer, and is tested there.
/// </summary>
public class DailyRecapGroupRepositoryTests
{
    private const string Creator = "alice@scoular.com";
    private const string Caller = "mgr@scoular.com";

    private static ApplicationDbContext NewContext() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"recapgroups-{Guid.NewGuid()}")
            .Options);

    private static DailyRecapGroup Group(int id = 1, string createdBy = Creator, params DailyRecapGroupMember[] members) => new()
    {
        Id = id,
        Name = $"Group {id}",
        DeliveryMethod = "email",
        Enabled = true,
        CreatedBy = createdBy,
        CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
        Members = members.ToList(),
        CcEmails = [new DailyRecapGroupCcEmail { Email = "cc@scoular.com" }],
    };

    private static DailyRecapGroupMember Member(string type, string id) =>
        new() { MemberType = type, MemberId = id, MemberName = id };

    /// <summary>Caller "mgr" — a person member match, entitled to TU1 and group 7.</summary>
    private static RecapGroupAccess Access(string callerUpn = Caller) =>
        new(callerUpn, "mgr", ["TU1"], ["7"]);

    private static RecapGroupValues Values(params DailyRecapGroupMember[] members) =>
        new("Renamed", "email", null, false, members.ToList(), [new DailyRecapGroupCcEmail { Email = "new@scoular.com" }]);

    // ── Visibility, which is also editability ────────────────────────────────
    [Theory]
    [InlineData("creator", true)]
    [InlineData("person", true)]
    [InlineData("trade-unit", true)]
    [InlineData("trade-unit-group", true)]
    [InlineData("stranger", false)]
    public async Task GetVisibleByIdAsync_MatchesCreatorAndEveryMemberKind(string relationship, bool expectVisible)
    {
        using var db = NewContext();
        db.DailyRecapGroups.Add(relationship switch
        {
            "creator" => Group(createdBy: Caller),
            "person" => Group(members: Member("person", "mgr")),
            "trade-unit" => Group(members: Member("trade-unit", "TU1")),
            "trade-unit-group" => Group(members: Member("trade-unit-group", "7")),
            _ => Group(members: Member("person", "someoneelse")),
        });
        await db.SaveChangesAsync();
        var repo = new DailyRecapGroupRepository(db);

        var found = await repo.GetVisibleByIdAsync(1, Access(), CancellationToken.None);

        Assert.Equal(expectVisible, found != null);
    }

    [Fact]
    public async Task GetVisibleByIdAsync_EmptyAccessSets_MatchesCreatorOnly()
    {
        // The degraded authorization path: when entitlements cannot be read the service passes
        // RecapGroupAccess.CreatorOnly, whose empty collections must narrow the predicate to
        // CreatedBy rather than widening it.
        using var db = NewContext();
        db.DailyRecapGroups.AddRange(
            Group(1, createdBy: Caller),
            Group(2, createdBy: Creator, members: Member("trade-unit", "TU1")));
        await db.SaveChangesAsync();
        var repo = new DailyRecapGroupRepository(db);
        var degraded = RecapGroupAccess.CreatorOnly(Caller, "mgr");

        Assert.NotNull(await repo.GetVisibleByIdAsync(1, degraded, CancellationToken.None));
        Assert.Null(await repo.GetVisibleByIdAsync(2, degraded, CancellationToken.None));
    }

    [Fact]
    public async Task GetVisibleAsync_ReturnsOwnedAndMemberOf_OrderedByName()
    {
        using var db = NewContext();
        db.DailyRecapGroups.AddRange(
            Group(1, createdBy: Caller),
            Group(2, createdBy: Creator, members: Member("person", "mgr")),
            Group(3, createdBy: Creator, members: Member("person", "someoneelse")));
        await db.SaveChangesAsync();
        var repo = new DailyRecapGroupRepository(db);

        var groups = await repo.GetVisibleAsync(Access(), CancellationToken.None);

        Assert.Equal([1, 2], groups.Select(g => g.Id).ToArray());
    }

    // ── Update: a member may edit, and the audit trail names them ────────────
    [Fact]
    public async Task UpdateAsync_MemberCanEdit_AndModifiedByIsTheEditorNotTheCreator()
    {
        using var db = NewContext();
        db.DailyRecapGroups.Add(Group(members: Member("person", "mgr")));
        await db.SaveChangesAsync();
        var repo = new DailyRecapGroupRepository(db);

        var updated = await repo.UpdateAsync(1, Access(), Values(Member("person", "mgr")), CancellationToken.None);

        Assert.NotNull(updated);
        Assert.Equal("Renamed", updated!.Name);
        Assert.Equal(Caller, updated.ModifiedBy);    // audit trail = actual editor
        Assert.Equal(Creator, updated.CreatedBy);    // ownership never reassigned
    }

    [Fact]
    public async Task UpdateAsync_Stranger_ReturnsNull_AndDoesNotMutate()
    {
        using var db = NewContext();
        db.DailyRecapGroups.Add(Group(members: Member("person", "someoneelse")));
        await db.SaveChangesAsync();
        var repo = new DailyRecapGroupRepository(db);

        var updated = await repo.UpdateAsync(1, Access(), Values(), CancellationToken.None);

        Assert.Null(updated);
        Assert.Equal("Group 1", (await db.DailyRecapGroups.AsNoTracking().SingleAsync()).Name);
    }

    [Fact]
    public async Task UpdateAsync_ReplacesMembersAndCcWholesale()
    {
        using var db = NewContext();
        db.DailyRecapGroups.Add(Group(1, Creator, Member("person", "mgr"), Member("trade-unit", "TU1")));
        await db.SaveChangesAsync();
        var repo = new DailyRecapGroupRepository(db);

        await repo.UpdateAsync(1, Access(), Values(Member("person", "mgr")), CancellationToken.None);

        var members = await db.DailyRecapGroupMembers.AsNoTracking().ToListAsync();
        Assert.Equal("mgr", Assert.Single(members).MemberId);
        var cc = await db.DailyRecapGroupCcEmails.AsNoTracking().ToListAsync();
        Assert.Equal("new@scoular.com", Assert.Single(cc).Email);
    }

    // ── Enabled toggle follows the same predicate ────────────────────────────
    [Fact]
    public async Task SetEnabledAsync_MemberCanToggle()
    {
        using var db = NewContext();
        db.DailyRecapGroups.Add(Group(members: Member("trade-unit-group", "7")));
        await db.SaveChangesAsync();
        var repo = new DailyRecapGroupRepository(db);

        var updated = await repo.SetEnabledAsync(1, Access(), false, CancellationToken.None);

        Assert.False(updated!.Enabled);
        Assert.Equal(Caller, updated.ModifiedBy);
    }

    [Fact]
    public async Task SetEnabledAsync_Stranger_ReturnsNull()
    {
        using var db = NewContext();
        db.DailyRecapGroups.Add(Group(members: Member("person", "someoneelse")));
        await db.SaveChangesAsync();
        var repo = new DailyRecapGroupRepository(db);

        Assert.Null(await repo.SetEnabledAsync(1, Access(), false, CancellationToken.None));
    }

    // ── Delete stays creator-only, and reports whether it happened ───────────
    [Fact]
    public async Task DeleteAsync_Creator_ReturnsTrue()
    {
        using var db = NewContext();
        db.DailyRecapGroups.Add(Group(createdBy: Caller));
        await db.SaveChangesAsync();
        var repo = new DailyRecapGroupRepository(db);

        Assert.True(await repo.DeleteAsync(1, Caller, CancellationToken.None));
        Assert.Empty(await db.DailyRecapGroups.AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task DeleteAsync_NonCreator_ReturnsFalse_AndRowSurvives()
    {
        // Defence-in-depth behind the service's 403. The bool is what stops the controller logging an
        // AUDIT_DELETE for a delete that never happened. Only the parent row is asserted: InMemory
        // does not enforce FKs, and child cleanup relies on the real DB cascade.
        using var db = NewContext();
        db.DailyRecapGroups.Add(Group(members: Member("person", "mgr")));
        await db.SaveChangesAsync();
        var repo = new DailyRecapGroupRepository(db);

        Assert.False(await repo.DeleteAsync(1, Caller, CancellationToken.None));
        Assert.Single(await db.DailyRecapGroups.AsNoTracking().ToListAsync());
    }

    // ── The unscoped read used only for the 403-vs-404 decision ──────────────
    [Fact]
    public async Task GetByIdAsync_IgnoresAccess_SoDeleteCanTell404From403()
    {
        using var db = NewContext();
        db.DailyRecapGroups.Add(Group(members: Member("person", "someoneelse")));
        await db.SaveChangesAsync();
        var repo = new DailyRecapGroupRepository(db);

        Assert.NotNull(await repo.GetByIdAsync(1, CancellationToken.None));
        Assert.Null(await repo.GetByIdAsync(99, CancellationToken.None));
    }
}
