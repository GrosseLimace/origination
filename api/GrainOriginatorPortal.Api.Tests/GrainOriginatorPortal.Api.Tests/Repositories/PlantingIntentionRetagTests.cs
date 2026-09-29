// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Retag moves every one of a producer's planting intentions off a trade unit they were just removed
/// from. Once moved, those rows look exactly like any already on the target trade unit, so the log line
/// is the only record of WHICH rows moved - without it a mistaken move cannot be undone. Recorded
/// under AR-01 (update 2026-09-28) as the compensating control for this route.
/// </summary>
public class PlantingIntentionRetagTests
{
    private const long CustomerId = 100;

    private static ApplicationDbContext NewContext()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"planting-retag-{Guid.NewGuid()}")
            .Options);
        db.Customers.Add(new Customer { Id = CustomerId, Name = "Smith Farm", ScoularId = "S1" });
        db.PlantingIntentions.AddRange(
            Row(1, "2210"),
            Row(2, "2210"),
            Row(3, "2190"),                          // already on the target: must not appear as moved
            Row(4, "2210", deleted: true));          // soft-deleted: must not follow the producer
        db.SaveChanges();
        return db;
    }

    private static PlantingIntention Row(int id, string tradeUnit, bool deleted = false) => new()
    {
        Id = id, CustomerId = CustomerId, TradeUnit = tradeUnit, PlantingYear = 2027, Crop = "YC",
        Acres = 100, CreatedBy = "author", IsDeleted = deleted,
    };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task MovesOnlyTheLiveRowsOnTheVacatedTradeUnit_AndLogsWhichOnesAndWho()
    {
        using var db = NewContext();
        var logger = new CapturingLogger<PlantingIntentionRepository>();

        var moved = await new PlantingIntentionRepository(db, logger)
            .RetagAsync(CustomerId, "2210", "2190", "tester", CancellationToken.None);

        Assert.Equal(2, moved);
        var rows = await db.PlantingIntentions.IgnoreQueryFilters().OrderBy(p => p.Id).ToListAsync();
        Assert.Equal(["2190", "2190", "2190", "2210"], rows.Select(r => r.TradeUnit));
        Assert.All(rows.Where(r => r.Id is 1 or 2), r => Assert.Equal("tester", r.ModifiedBy));
        Assert.Null(rows.Single(r => r.Id == 3).ModifiedBy);

        var line = Assert.Single(logger.Entries).Fields;
        Assert.Equal("1,2", line["IntentionIds"]);
        Assert.Equal("tester", line["User"]);
        Assert.Equal("2210", line["FromTradeUnit"]);
        Assert.Equal("2190", line["ToTradeUnit"]);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task NothingOnTheVacatedTradeUnit_ChangesNothingAndLogsNothing()
    {
        using var db = NewContext();
        var logger = new CapturingLogger<PlantingIntentionRepository>();

        var moved = await new PlantingIntentionRepository(db, logger)
            .RetagAsync(CustomerId, "9999", "2190", "tester", CancellationToken.None);

        Assert.Equal(0, moved);
        Assert.Empty(logger.Entries);
    }
}
