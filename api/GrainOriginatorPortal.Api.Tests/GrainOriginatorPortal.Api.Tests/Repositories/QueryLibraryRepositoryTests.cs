// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Direct coverage of <see cref="QueryLibraryRepository"/> against an InMemory database: the
/// active-only read in Category → SortOrder → Name order that drives the Build-a-List library, and
/// the search-log append.
/// </summary>
public class QueryLibraryRepositoryTests
{
    private static (QueryLibraryRepository Sut, ApplicationDbContext Db) Build()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"querylib-{Guid.NewGuid()}").Options);
        return (new QueryLibraryRepository(db), db);
    }

    private static QueryLibraryItem Item(int id, string category, int sortOrder, string name, bool isActive = true) => new()
    {
        Id = id, Category = category, SortOrder = sortOrder, Name = name, QueryText = name.ToLowerInvariant(), IsActive = isActive
    };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetActiveAsync_OrdersByCategoryThenSortOrderThenName()
    {
        var (sut, db) = Build();
        db.QueryLibrary.AddRange(
            Item(1, "Crops", 2, "Wheat"),
            Item(2, "Crops", 1, "Zebra corn"),     // lower sort order wins over name
            Item(3, "Crops", 2, "Corn"),           // same sort order → name breaks the tie
            Item(4, "Activity", 9, "Recent notes"),
            Item(5, "Crops", 0, "Hidden", isActive: false));
        await db.SaveChangesAsync();

        var items = await sut.GetActiveAsync(CancellationToken.None);

        Assert.Equal(new[] { "Recent notes", "Zebra corn", "Corn", "Wheat" }, items.Select(i => i.Name));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetActiveAsync_NoActiveItems_ReturnsEmpty()
    {
        var (sut, db) = Build();
        db.QueryLibrary.Add(Item(1, "Crops", 1, "Hidden", isActive: false));
        await db.SaveChangesAsync();

        Assert.Empty(await sut.GetActiveAsync(CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AddSearchLogAsync_PersistsTheRowAsGiven()
    {
        var (sut, db) = Build();
        var when = new DateTime(2026, 3, 1, 12, 0, 0, DateTimeKind.Utc);

        await sut.AddSearchLogAsync(new QuerySearchLog { UserId = "cegr", SearchText = "flax near", MatchedQueryId = null, Timestamp = when }, CancellationToken.None);
        await sut.AddSearchLogAsync(new QuerySearchLog { UserId = "cegr", SearchText = "corn", MatchedQueryId = 7, Timestamp = when }, CancellationToken.None);

        var rows = await db.QuerySearchLogs.OrderBy(l => l.SearchText).ToListAsync();
        Assert.Equal(new (string, int?)[] { ("corn", 7), ("flax near", null) }, rows.Select(r => (r.SearchText, r.MatchedQueryId)));
        Assert.All(rows, r => Assert.True(r.Id > 0));
    }
}
