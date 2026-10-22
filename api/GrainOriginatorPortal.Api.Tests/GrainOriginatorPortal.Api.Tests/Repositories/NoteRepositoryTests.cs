// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Direct coverage of <see cref="NoteRepository"/> against an InMemory database: the soft-delete
/// rule that every read honours, the producer name/code composed from the Customer join, the
/// last-contact aggregate, and the mentions-preserving edit rule.
/// </summary>
/// <remarks>
/// Deliberately NOT tested here: the bulk <c>GetAsync</c> read. Its first statement is
/// <c>SetCommandTimeout(120)</c>, a relational-only call the InMemory provider rejects, so its
/// trade-unit / keyword / author / pinned / recency filters need the real-SQL harness.
/// </remarks>
public class NoteRepositoryTests
{
    private const long Smith = 100;
    private const long Jones = 200;

    private static ApplicationDbContext NewContext()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"notes-{Guid.NewGuid()}")
            .Options);
        db.Customers.Add(new Customer { Id = Smith, Name = "Smith Farm", ScoularId = "SMITH" });
        db.Customers.Add(new Customer { Id = Jones, Name = "Jones Farm", ScoularId = null });
        db.SaveChanges();
        return db;
    }

    private static NoteRepository Repo(ApplicationDbContext db) =>
        new(db, NullLogger<NoteRepository>.Instance);

    private static Note Note(int id, long customerId, int dayOfMonth, bool isDeleted = false, bool isPinned = false, string? mentions = null) => new()
    {
        Id = id, CustomerId = customerId, Description = $"note {id}", CreatedBy = "alice",
        CreatedAt = new DateTime(2026, 2, dayOfMonth, 0, 0, 0, DateTimeKind.Utc), IsDeleted = isDeleted, IsPinned = isPinned, MentionsJson = mentions
    };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByCustomerAsync_SkipsDeleted_NewestFirst_AndComposesProducerNameAndCode()
    {
        using var db = NewContext();
        db.Notes.AddRange(Note(1, Smith, 1), Note(2, Smith, 5), Note(3, Smith, 3, isDeleted: true), Note(4, Jones, 9));
        await db.SaveChangesAsync();

        var notes = await Repo(db).GetByCustomerAsync(Smith, CancellationToken.None);

        Assert.Equal(new[] { 2, 1 }, notes.Select(n => n.Id));
        Assert.All(notes, n => Assert.Equal(("Smith Farm", "SMITH"), (n.CustomerName, n.CustomerCode)));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByIdAsync_ReturnsLiveNote_NullForDeletedOrUnknown()
    {
        using var db = NewContext();
        db.Notes.AddRange(Note(1, Jones, 1), Note(2, Jones, 2, isDeleted: true));
        await db.SaveChangesAsync();
        var repo = Repo(db);

        var live = await repo.GetByIdAsync(1, CancellationToken.None);

        Assert.NotNull(live);
        Assert.Equal(("Jones Farm", null), (live!.CustomerName, live.CustomerCode));   // a producer with no code stays null, not ""
        Assert.Null(await repo.GetByIdAsync(2, CancellationToken.None));
        Assert.Null(await repo.GetByIdAsync(99, CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetLastContactAsync_OneRowPerProducer_WithTheLatestLiveNote()
    {
        using var db = NewContext();
        db.Notes.AddRange(
            Note(1, Smith, 1), Note(2, Smith, 20), Note(3, Smith, 28, isDeleted: true),   // deleted note must not count as contact
            Note(4, Jones, 7));
        await db.SaveChangesAsync();

        var rows = (await Repo(db).GetLastContactAsync(CancellationToken.None)).ToDictionary(r => r.CustomerId);

        Assert.Equal(2, rows.Count);
        Assert.Equal((new DateTime(2026, 2, 20), "SMITH"), (rows[Smith].LastNoteAt, rows[Smith].CustomerCode));
        Assert.Equal((new DateTime(2026, 2, 7), null), (rows[Jones].LastNoteAt, rows[Jones].CustomerCode));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AddAsync_SnapshotsProducerNameAndCode_AndStampsTheAuthor()
    {
        using var db = NewContext();
        var repo = Repo(db);

        var note = await repo.AddAsync(Smith, "Called about corn", "4056", "[{\"id\":\"hcol\"}]", "cegr", CancellationToken.None);

        Assert.True(note.Id > 0);
        Assert.Equal(("Smith Farm", "SMITH", "4056", "cegr"), (note.CustomerName, note.CustomerCode, note.TradeUnit, note.CreatedBy));
        Assert.Equal("[{\"id\":\"hcol\"}]", note.MentionsJson);
        Assert.False(note.IsDeleted);
        Assert.Equal(1, await db.Notes.CountAsync());
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AddAsync_UnknownProducer_StillSavesWithAnEmptyName()
    {
        using var db = NewContext();

        var note = await Repo(db).AddAsync(999, "orphan", null, null, "cegr", CancellationToken.None);

        Assert.Equal((string.Empty, null), (note.CustomerName, note.CustomerCode));
        Assert.Equal(999, note.CustomerId);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task TogglePinAsync_FlipsThePin_AndIgnoresDeletedOrMissingNotes()
    {
        using var db = NewContext();
        db.Notes.AddRange(Note(1, Smith, 1), Note(2, Smith, 2, isDeleted: true, isPinned: false));
        await db.SaveChangesAsync();
        var repo = Repo(db);

        var pinned = await repo.TogglePinAsync(1, CancellationToken.None);
        Assert.True(pinned!.IsPinned);
        Assert.Equal("Smith Farm", pinned.CustomerName);

        // Same tracked instance comes back, so assert before toggling again rather than holding both.
        var unpinned = await repo.TogglePinAsync(1, CancellationToken.None);
        Assert.False(unpinned!.IsPinned);
        Assert.Null(await repo.TogglePinAsync(2, CancellationToken.None));
        Assert.Null(await repo.TogglePinAsync(99, CancellationToken.None));
        Assert.False((await db.Notes.SingleAsync(n => n.Id == 2)).IsPinned);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(false, "[\"new\"]", "[\"old\"]")]   // mentions not supplied → untouched, even though a value came along
    [InlineData(true, "[\"new\"]", "[\"new\"]")]    // supplied → replaced
    [InlineData(true, null, null)]                  // supplied as null → explicitly cleared
    public async Task UpdateAsync_OnlyTouchesMentionsWhenAskedTo(bool replaceMentions, string? mentions, string? expected)
    {
        using var db = NewContext();
        db.Notes.Add(Note(1, Smith, 1, mentions: "[\"old\"]"));
        await db.SaveChangesAsync();

        var updated = await Repo(db).UpdateAsync(1, "edited", mentions, replaceMentions, "bob", CancellationToken.None);

        Assert.NotNull(updated);
        Assert.Equal(("edited", expected, "bob"), (updated!.Description, updated.MentionsJson, updated.ModifiedBy));
        Assert.NotNull(updated.ModifiedAt);
        Assert.Equal("alice", updated.CreatedBy);            // authorship unchanged
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task UpdateAsync_DeletedOrMissingNote_ReturnsNullAndChangesNothing()
    {
        using var db = NewContext();
        db.Notes.Add(Note(1, Smith, 1, isDeleted: true));
        await db.SaveChangesAsync();
        var repo = Repo(db);

        Assert.Null(await repo.UpdateAsync(1, "edited", null, false, "bob", CancellationToken.None));
        Assert.Null(await repo.UpdateAsync(99, "edited", null, false, "bob", CancellationToken.None));
        Assert.Equal("note 1", (await db.Notes.SingleAsync()).Description);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task DeleteAsync_SoftDeletes_KeepsTheRow_AndIsIdempotent()
    {
        using var db = NewContext();
        db.Notes.Add(Note(1, Smith, 1));
        await db.SaveChangesAsync();
        var repo = Repo(db);

        await repo.DeleteAsync(1, "cegr", CancellationToken.None);
        await repo.DeleteAsync(1, "someone-else", CancellationToken.None);   // already deleted → no-op, stamp preserved
        await repo.DeleteAsync(99, "cegr", CancellationToken.None);          // unknown → no throw

        var row = await db.Notes.SingleAsync();
        Assert.True(row.IsDeleted);
        Assert.Equal("cegr", row.DeletedBy);
        Assert.NotNull(row.DeletedAt);
        Assert.Empty(await repo.GetByCustomerAsync(Smith, CancellationToken.None));
    }
}
