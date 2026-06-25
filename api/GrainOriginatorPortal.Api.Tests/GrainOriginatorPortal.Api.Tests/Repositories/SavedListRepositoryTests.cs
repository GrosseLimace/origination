// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Exercises the manager-access additions to <see cref="SavedListRepository"/> against an
/// InMemory database: trade-unit overlap matching (excluding the caller's own lists) and the
/// admin <c>canManageAny</c> override on Update/Delete.
/// </summary>
public class SavedListRepositoryTests
{
    private static ApplicationDbContext NewContext() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"savedlists-{Guid.NewGuid()}")
            .Options);

    private static SavedList List(int id, string createdBy, string? tradeUnits, bool isActive = true, string? assignedTo = null) => new()
    {
        Id = id,
        Name = $"List {id}",
        Query = "corn",
        TradeUnits = tradeUnits,
        CreatedBy = createdBy,
        CreatedAt = new DateTime(2026, 1, id, 0, 0, 0, DateTimeKind.Utc),
        IsActive = isActive,
        AssignedTo = assignedTo,
    };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByUserAsync_ReturnsOwnNonAssigned_AndAssignedToMe_NewestFirst()
    {
        using var db = NewContext();
        db.SavedLists.AddRange(
            List(1, "me@x.com", "TU1"),                            // own, not assigned → included
            List(2, "me@x.com", "TU1", assignedTo: "sam@x.com"),   // own but assigned away → excluded
            List(3, "joe@x.com", "TU1", assignedTo: "me@x.com"),   // assigned to me → included
            List(4, "joe@x.com", "TU1"),                           // someone else's → excluded
            List(5, "me@x.com", "TU1", isActive: false)            // inactive → excluded
        );
        await db.SaveChangesAsync();
        var repo = new SavedListRepository(db);

        var result = await repo.GetByUserAsync("me@x.com", CancellationToken.None);

        Assert.Equal(new[] { 3, 1 }, result.Select(l => l.Id).ToArray()); // newest-first
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByTradeUnitsAsync_ReturnsOverlapping_ExcludingCallerAndNonMatches()
    {
        using var db = NewContext();
        db.SavedLists.AddRange(
            List(1, "joe@x.com", "TU1"),            // overlap → included
            List(2, "amy@x.com", "TU1,TU2"),        // overlap (multi-TU) → included
            List(3, "sam@x.com", "TU3"),            // no overlap → excluded
            List(4, "me@x.com", "TU1"),             // caller's own personal → excluded
            List(5, "ed@x.com", "TU2", isActive: false), // inactive → excluded
            List(6, "ed@x.com", null),              // null TUs → excluded
            List(7, "me@x.com", "TU1", assignedTo: "sam@x.com"),  // caller assigned to sam → included ("for sam")
            List(8, "joe@x.com", "TU1", assignedTo: "me@x.com")   // assigned TO caller → excluded (lives in My Lists)
        );
        await db.SaveChangesAsync();
        var repo = new SavedListRepository(db);

        var result = await repo.GetByTradeUnitsAsync(new[] { "TU1" }, "me@x.com", CancellationToken.None);

        Assert.Equal(new[] { 7, 2, 1 }, result.Select(l => l.Id).ToArray()); // newest-first
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByTradeUnitsAsync_EmptyRequest_ReturnsEmpty()
    {
        using var db = NewContext();
        db.SavedLists.Add(List(1, "joe@x.com", "TU1"));
        await db.SaveChangesAsync();

        var result = await new SavedListRepository(db)
            .GetByTradeUnitsAsync(Array.Empty<string>(), "me@x.com", CancellationToken.None);

        Assert.Empty(result);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(true, true)]   // manager → can update another user's list
    [InlineData(false, false)] // non-owner without manager rights → no-op (null)
    public async Task UpdateAsync_HonorsCanManageAny(bool canManageAny, bool expectUpdated)
    {
        using var db = NewContext();
        db.SavedLists.Add(List(1, "joe@x.com", "TU1"));
        await db.SaveChangesAsync();
        var repo = new SavedListRepository(db);

        var updated = await repo.UpdateAsync(1, "me@x.com", canManageAny, "Renamed", "wheat",
            "TU1", null, null, null, CancellationToken.None);

        if (expectUpdated)
        {
            Assert.NotNull(updated);
            Assert.Equal("Renamed", updated!.Name);
            Assert.Equal("me@x.com", updated.ModifiedBy); // audit trail = actual editor
            Assert.Equal("joe@x.com", updated.CreatedBy);  // ownership unchanged
        }
        else
        {
            Assert.Null(updated);
        }
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task UpdateAsync_AllowsAssignee_EvenWithoutManagerRights()
    {
        using var db = NewContext();
        db.SavedLists.Add(List(1, "joe@x.com", "TU1", assignedTo: "me@x.com")); // assigned to caller
        await db.SaveChangesAsync();
        var repo = new SavedListRepository(db);

        // canManageAny=false, CreatedBy != caller, but AssignedTo == caller UPN → allowed
        var updated = await repo.UpdateAsync(1, "me@x.com", canManageAny: false, "Renamed", "wheat",
            "TU1", null, null, null, CancellationToken.None);

        Assert.NotNull(updated);
        Assert.Equal("Renamed", updated!.Name);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(true, true)]    // manager → deletes another user's list
    [InlineData(false, false)]  // non-owner without manager rights → no-op
    public async Task DeleteAsync_HonorsCanManageAny(bool canManageAny, bool expectDeleted)
    {
        using var db = NewContext();
        db.SavedLists.Add(List(1, "joe@x.com", "TU1"));
        await db.SaveChangesAsync();
        var repo = new SavedListRepository(db);

        await repo.DeleteAsync(1, "me@x.com", canManageAny, CancellationToken.None);

        Assert.Equal(expectDeleted ? 0 : 1, await db.SavedLists.CountAsync());
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AddRangeAsync_PersistsAllCopies()
    {
        using var db = NewContext();
        var repo = new SavedListRepository(db);

        await repo.AddRangeAsync(new[]
        {
            List(1, "mgr@x.com", "TU1", assignedTo: "sam"),
            List(2, "mgr@x.com", "TU1", assignedTo: "dana"),
        }, CancellationToken.None);

        Assert.Equal(2, await db.SavedLists.CountAsync());
    }
}
