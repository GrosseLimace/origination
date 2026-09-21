// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// M-043 (2026-09-21). Planting-intention delete was a HARD delete of hand-entered forward crop
/// plans with no upstream system of record, on a live UI button. The AUDIT_DELETE line named the
/// id but never the acreage, so attribution alone could not reconstruct what was lost.
///
/// These tests pin the two halves of the replacement: the row must SURVIVE a delete, and every
/// read must stop returning it. The second half rests on the global query filter in
/// ApplicationDbContext rather than a per-query predicate — so it is tested through the repository's
/// real read paths, which is the only way to catch a query that forgot to filter.
/// </summary>
public class PlantingIntentionSoftDeleteTests
{
    private const long CustomerId = 100;

    private static ApplicationDbContext NewContext()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"planting-softdelete-{Guid.NewGuid()}")
            .Options);
        db.Customers.Add(new Customer { Id = CustomerId, Name = "Smith Farm", ScoularId = "S1" });
        db.PlantingIntentions.Add(new PlantingIntention
        {
            Id = 1,
            CustomerId = CustomerId,
            TradeUnit = "2090",
            PlantingYear = 2027,
            Crop = "Yellow Corn",
            Acres = 640,
            CreatedBy = "author",
        });
        db.SaveChanges();
        return db;
    }

    // No ODS context: this branch removed it from the repository entirely when the last runtime
    // ODS contract read was dropped, so producer scoping now comes from the app's own Customer /
    // CustomerTradeUnit tables. main's version of this helper passed an empty in-memory ODS context
    // because none of the paths under test touched it - here there is nothing to pass.
    private static PlantingIntentionRepository Repo(ApplicationDbContext db) =>
        new(db, NullLogger<PlantingIntentionRepository>.Instance);

    // -------------------------------------------------------------------------
    // The point of the change: the plan is recoverable afterwards.
    [Fact]
    public async Task DeleteAsync_KeepsTheRow_AndStampsWhoAndWhen()
    {
        using var db = NewContext();

        await Repo(db).DeleteAsync(1, "tester", CancellationToken.None);

        var row = await db.PlantingIntentions.IgnoreQueryFilters()
            .SingleAsync(p => p.Id == 1, CancellationToken.None);
        Assert.True(row.IsDeleted);
        Assert.Equal("tester", row.DeletedBy);
        Assert.NotNull(row.DeletedAt);
        // The acreage the AUDIT_DELETE line could never carry is still here to restore from.
        Assert.Equal(640, row.Acres);
        Assert.Equal("Yellow Corn", row.Crop);
    }

    // -------------------------------------------------------------------------
    // Each of these would silently resurrect a deleted plan if the filter were missing. GetAsync
    // feeds the trade-unit acreage rollups, where a stale row becomes a wrong SUM with no error.
    [Fact]
    public async Task AfterDelete_TheIntentionIsGoneFromEveryReadPath()
    {
        using var db = NewContext();
        var repo = Repo(db);

        await repo.DeleteAsync(1, "tester", CancellationToken.None);

        Assert.Empty(await repo.GetAsync(null, null, CancellationToken.None));
        Assert.Empty(await repo.GetByCustomerAsync(CustomerId, CancellationToken.None));
        Assert.Null(await repo.GetByIdAsync(1, CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    // Guards the filter itself: a live row must still come back, or the test above would pass
    // against a repository that returns nothing at all.
    [Fact]
    public async Task BeforeDelete_TheIntentionIsVisibleOnEveryReadPath()
    {
        using var db = NewContext();
        var repo = Repo(db);

        Assert.Single(await repo.GetAsync(null, null, CancellationToken.None));
        Assert.Single(await repo.GetByCustomerAsync(CustomerId, CancellationToken.None));
        Assert.NotNull(await repo.GetByIdAsync(1, CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    // Deleting an id that does not exist stays a no-op, matching the pre-change behaviour so the
    // route keeps returning 204 rather than becoming an existence oracle.
    [Fact]
    public async Task DeleteAsync_ForAnUnknownId_DoesNothing()
    {
        using var db = NewContext();

        await Repo(db).DeleteAsync(999, "tester", CancellationToken.None);

        Assert.False(await db.PlantingIntentions.IgnoreQueryFilters()
            .Where(p => p.IsDeleted).AnyAsync(CancellationToken.None));
    }
}
