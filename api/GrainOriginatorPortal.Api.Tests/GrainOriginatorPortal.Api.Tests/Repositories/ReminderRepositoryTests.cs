// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Pins the owner predicate that makes producer reminders private. Unlike notes, which every rep
/// can read and edit, a reminder belongs to exactly one user — and because that rule lives in the
/// repository rather than in a check each caller performs, this is where it has to be proven.
///
/// Every test asks the same question from a different angle: can a second user reach the first user
/// rows? Reads must not return them and writes must report "no such row" (null / false), which the
/// service turns into a 404 so the API never confirms another user follow-up exists.
/// </summary>
public class ReminderRepositoryTests
{
    private const string Owner = "alice@scoular.com";
    private const string Stranger = "bob@scoular.com";

    private static readonly DateTime Due = new(2026, 10, 1, 15, 0, 0, DateTimeKind.Utc);

    private static ApplicationDbContext NewContext()
    {
        var context = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase($"reminders-{Guid.NewGuid()}")
                .Options);

        context.Customers.AddRange(
            new Customer { Id = 10, Name = "Smith Farms", ScoularId = "C-10" },
            new Customer { Id = 20, Name = "Jones Grain", ScoularId = "C-20" });
        context.SaveChanges();
        return context;
    }

    private static ReminderRepository NewRepository(ApplicationDbContext context) =>
        new(context, new Mock<ILogger<ReminderRepository>>().Object);

    private static ProducerReminder Seed(
        ApplicationDbContext context,
        int id,
        string createdBy = Owner,
        long customerId = 10,
        bool isCompleted = false,
        DateTime? dueAt = null)
    {
        var reminder = new ProducerReminder
        {
            Id = id,
            CustomerId = customerId,
            DueAt = dueAt ?? Due,
            Subject = $"Follow up {id}",
            CreatedBy = createdBy,
            CreatedAt = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc),
            IsCompleted = isCompleted
        };
        context.ProducerReminders.Add(reminder);
        context.SaveChanges();
        return reminder;
    }

    // ── Reads are scoped to the owner ────────────────────────────────────────
    [Fact]
    public async Task GetByCustomerAsync_ReturnsOnlyCallerOwnReminders()
    {
        // Arrange
        using var context = NewContext();
        Seed(context, 1, createdBy: Owner);
        Seed(context, 2, createdBy: Stranger);
        var sut = NewRepository(context);

        // Act
        var mine = await sut.GetByCustomerAsync(10, Owner, includeCompleted: false, CancellationToken.None);

        // Assert
        Assert.Equal([1], mine.Select(r => r.Id));
    }

    [Fact]
    public async Task GetByCustomerAsync_MatchesOwnerCaseInsensitively()
    {
        // Arrange — the UPN casing a token carries is not guaranteed to match what was stored.
        using var context = NewContext();
        Seed(context, 1, createdBy: "Alice@Scoular.com");
        var sut = NewRepository(context);

        // Act
        var mine = await sut.GetByCustomerAsync(10, "alice@scoular.com", includeCompleted: false, CancellationToken.None);

        // Assert
        Assert.Single(mine);
    }

    [Fact]
    public async Task GetByCustomerAsync_ExcludesCompletedUnlessAsked()
    {
        // Arrange
        using var context = NewContext();
        Seed(context, 1, isCompleted: false);
        Seed(context, 2, isCompleted: true);
        var sut = NewRepository(context);

        // Act
        var open = await sut.GetByCustomerAsync(10, Owner, includeCompleted: false, CancellationToken.None);
        var all = await sut.GetByCustomerAsync(10, Owner, includeCompleted: true, CancellationToken.None);

        // Assert
        Assert.Equal([1], open.Select(r => r.Id));
        Assert.Equal(2, all.Count);
    }

    [Fact]
    public async Task GetByCustomerAsync_ComposesProducerIdentityFromTheCustomerJoin()
    {
        // Arrange — CustomerName/CustomerCode are not stored on the row.
        using var context = NewContext();
        Seed(context, 1);
        var sut = NewRepository(context);

        // Act
        var mine = await sut.GetByCustomerAsync(10, Owner, includeCompleted: false, CancellationToken.None);

        // Assert
        Assert.Equal("Smith Farms", mine[0].CustomerName);
        Assert.Equal("C-10", mine[0].CustomerCode);
    }

    [Fact]
    public async Task GetOpenForOwnerAsync_ReturnsOwnOpenRemindersAcrossProducersSoonestFirst()
    {
        // Arrange
        using var context = NewContext();
        Seed(context, 1, customerId: 10, dueAt: Due.AddDays(5));
        Seed(context, 2, customerId: 20, dueAt: Due.AddDays(1));
        Seed(context, 3, customerId: 10, isCompleted: true);
        Seed(context, 4, customerId: 10, createdBy: Stranger);
        var sut = NewRepository(context);

        // Act
        var feed = await sut.GetOpenForOwnerAsync(Owner, CancellationToken.None);

        // Assert
        Assert.Equal([2, 1], feed.Select(r => r.Id));
    }

    [Fact]
    public async Task GetByIdAsync_ReturnsNullForAnotherUserReminder()
    {
        // Arrange
        using var context = NewContext();
        Seed(context, 1, createdBy: Stranger);
        var sut = NewRepository(context);

        // Act
        var found = await sut.GetByIdAsync(1, Owner, CancellationToken.None);

        // Assert
        Assert.Null(found);
    }

    // ── Writes are scoped to the owner ───────────────────────────────────────
    [Fact]
    public async Task AddAsync_StampsOwnerAndResolvesProducerIdentity()
    {
        // Arrange
        using var context = NewContext();
        var sut = NewRepository(context);

        // Act
        var created = await sut.AddAsync(10, Due, "Call about new crop", "bring the basis sheet", Owner, CancellationToken.None);

        // Assert
        Assert.Equal(Owner, created.CreatedBy);
        Assert.Equal("Smith Farms", created.CustomerName);
        Assert.Equal("C-10", created.CustomerCode);
        Assert.False(created.IsCompleted);
        Assert.Null(created.OutlookEventId);
    }

    [Fact]
    public async Task UpdateAsync_RejectsAnotherUserReminderAndLeavesItUntouched()
    {
        // Arrange
        using var context = NewContext();
        Seed(context, 1, createdBy: Stranger);
        var sut = NewRepository(context);

        // Act
        var result = await sut.UpdateAsync(1, Owner, Due.AddDays(3), "Hijacked", null, CancellationToken.None);

        // Assert
        Assert.Null(result);
        Assert.Equal("Follow up 1", context.ProducerReminders.AsNoTracking().Single().Subject);
    }

    [Fact]
    public async Task UpdateAsync_AppliesNewWindowForTheOwner()
    {
        // Arrange
        using var context = NewContext();
        Seed(context, 1);
        var sut = NewRepository(context);
        var moved = Due.AddDays(2);

        // Act
        var result = await sut.UpdateAsync(1, Owner, moved, "Rescheduled", "notes", CancellationToken.None);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(moved, result!.DueAt);
        Assert.Equal("Rescheduled", result.Subject);
        Assert.NotNull(result.ModifiedAt);
    }

    [Fact]
    public async Task SetCompletedAsync_SetsAndClearsTheCompletionStamp()
    {
        // Arrange
        using var context = NewContext();
        Seed(context, 1);
        var sut = NewRepository(context);

        // Act + Assert — read each result before the next call. The repository hands back the
        // TRACKED entity, so both calls return the same instance in a single context; under the API
        // each request has its own scoped context and the two results are unrelated objects.
        var completed = await sut.SetCompletedAsync(1, Owner, true, CancellationToken.None);
        Assert.True(completed!.IsCompleted);
        Assert.NotNull(completed.CompletedAt);

        var reopened = await sut.SetCompletedAsync(1, Owner, false, CancellationToken.None);
        Assert.False(reopened!.IsCompleted);
        Assert.Null(reopened.CompletedAt);
    }

    [Fact]
    public async Task SetCompletedAsync_RejectsAnotherUserReminder()
    {
        // Arrange
        using var context = NewContext();
        Seed(context, 1, createdBy: Stranger);
        var sut = NewRepository(context);

        // Act
        var result = await sut.SetCompletedAsync(1, Owner, true, CancellationToken.None);

        // Assert
        Assert.Null(result);
        Assert.False(context.ProducerReminders.AsNoTracking().Single().IsCompleted);
    }

    [Fact]
    public async Task SetOutlookEventIdAsync_LinksAndClearsWithoutTouchingModifiedAt()
    {
        // Arrange — linking the calendar event is bookkeeping, not a user edit.
        using var context = NewContext();
        Seed(context, 1);
        var sut = NewRepository(context);

        // Act + Assert — same tracked-entity caveat as the completion test above.
        var linked = await sut.SetOutlookEventIdAsync(1, Owner, "AAMkAD==", CancellationToken.None);
        Assert.Equal("AAMkAD==", linked!.OutlookEventId);
        Assert.Null(linked.ModifiedAt);

        var cleared = await sut.SetOutlookEventIdAsync(1, Owner, null, CancellationToken.None);
        Assert.Null(cleared!.OutlookEventId);
        Assert.Null(cleared.ModifiedAt);
    }

    [Fact]
    public async Task DeleteAsync_RemovesOwnReminderAndReportsSuccess()
    {
        // Arrange
        using var context = NewContext();
        Seed(context, 1);
        var sut = NewRepository(context);

        // Act
        var deleted = await sut.DeleteAsync(1, Owner, CancellationToken.None);

        // Assert
        Assert.True(deleted);
        Assert.Empty(context.ProducerReminders.AsNoTracking());
    }

    [Fact]
    public async Task DeleteAsync_LeavesAnotherUserReminderInPlace()
    {
        // Arrange
        using var context = NewContext();
        Seed(context, 1, createdBy: Stranger);
        var sut = NewRepository(context);

        // Act
        var deleted = await sut.DeleteAsync(1, Owner, CancellationToken.None);

        // Assert
        Assert.False(deleted);
        Assert.Single(context.ProducerReminders.AsNoTracking());
    }
}
