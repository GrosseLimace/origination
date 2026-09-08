// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Trade-unit scoping for Planting Intentions, which is now resolved from the app's own
/// customer/trade-unit snapshot alone.
/// </summary>
/// <remarks>
/// It previously also unioned in producer codes taken from ODS <c>base.vw_CurrentContracts</c>, which was
/// the last ODS contract read on the CTRM path. Removing it is only safe while membership is the thing that
/// decides who appears, so that is what these tests pin: a producer with a membership row is in, one
/// without is out, and neither answer depends on any contract existing anywhere.
/// </remarks>
public class PlantingIntentionScopingTests
{
    private const string InScopeUnit = "1340";
    private const string OtherUnit = "2057";

    private static ApplicationDbContext NewContext()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"planting-scope-{Guid.NewGuid()}")
            .Options);

        db.Customers.AddRange(
            new Customer { Id = 100, Name = "Member Farms", ScoularId = "MEMBER", IsActive = true },
            new Customer { Id = 200, Name = "Unaffiliated Farms", ScoularId = "NOTMINE", IsActive = true },
            new Customer { Id = 300, Name = "Removed From Unit Farms", ScoularId = "GONE", IsActive = true },
            // Deactivated CUSTOMER that still holds an active membership row - the one shape that proves
            // the IsActive check on the customer itself is doing something.
            new Customer { Id = 400, Name = "Closed Account Farms", ScoularId = "CLOSED", IsActive = false },
            // Known customer with NO membership row at all. This is the population the removed ODS
            // contract union used to be able to pull in, so it is the actual regression case.
            new Customer { Id = 500, Name = "No Membership Farms", ScoularId = "ORPHAN", IsActive = true });

        db.CustomerTradeUnits.AddRange(
            new CustomerTradeUnit { Id = 1, CustomerId = 100, TradeUnit = InScopeUnit, IsActive = true },
            new CustomerTradeUnit { Id = 2, CustomerId = 200, TradeUnit = OtherUnit, IsActive = true },
            // Deactivated membership: the producer is known, but not in this unit any more.
            new CustomerTradeUnit { Id = 3, CustomerId = 300, TradeUnit = InScopeUnit, IsActive = false },
            new CustomerTradeUnit { Id = 4, CustomerId = 400, TradeUnit = InScopeUnit, IsActive = true });

        db.PlantingIntentions.AddRange(
            new PlantingIntention { Id = 1, CustomerId = 100, PlantingYear = 2026, Crop = "YC", Acres = 500 },
            new PlantingIntention { Id = 2, CustomerId = 200, PlantingYear = 2026, Crop = "YSB", Acres = 300 },
            new PlantingIntention { Id = 3, CustomerId = 300, PlantingYear = 2026, Crop = "HRW", Acres = 100 },
            new PlantingIntention { Id = 4, CustomerId = 400, PlantingYear = 2026, Crop = "YC", Acres = 200 },
            new PlantingIntention { Id = 5, CustomerId = 500, PlantingYear = 2026, Crop = "YSB", Acres = 150 });

        db.SaveChanges();
        return db;
    }

    private static PlantingIntentionRepository Repo(ApplicationDbContext db) =>
        new(db, NullLogger<PlantingIntentionRepository>.Instance);

    [Fact]
    public async Task AProducerInTheUnitIsIncluded_AndOneInAnotherUnitIsNot()
    {
        using var db = NewContext();

        var results = await Repo(db).GetAsync([InScopeUnit], null, CancellationToken.None);

        Assert.Equal([100L], results.Select(r => r.CustomerId).ToArray());
    }

    [Fact]
    public async Task ADeactivatedMembershipDoesNotPutAProducerInScope()
    {
        using var db = NewContext();

        var results = await Repo(db).GetAsync([InScopeUnit], null, CancellationToken.None);

        Assert.DoesNotContain(300L, results.Select(r => r.CustomerId));
    }

    [Fact]
    public async Task AKnownProducerWithNoMembershipRowIsOutOfScope()
    {
        // The regression case worth naming. Before this change, a producer could be pulled into scope by
        // having a contract on the trade unit even with no membership row; that path is gone, so a customer
        // who exists but was never added to the unit is excluded. Measured on trade units 1340, 2057, 2115
        // and 2190 before shipping: zero real producers were in this state, and zero had a deactivated
        // membership either - the codes the contract scan added were all absent from dbo.Customer.
        using var db = NewContext();

        var results = await Repo(db).GetAsync([InScopeUnit], null, CancellationToken.None);

        Assert.DoesNotContain(500L, results.Select(r => r.CustomerId));
    }

    [Fact]
    public async Task AnInactiveCustomerIsExcludedEvenWithAnActiveMembershipRow()
    {
        // Membership is necessary but not sufficient: the customer has to be active too. Without a closed
        // account in the fixture the IsActive check could be deleted and every other test would still pass.
        using var db = NewContext();

        var results = await Repo(db).GetAsync([InScopeUnit], null, CancellationToken.None);

        Assert.DoesNotContain(400L, results.Select(r => r.CustomerId));
        Assert.Equal([100L], results.Select(r => r.CustomerId).ToArray());
    }

    [Fact]
    public async Task SeveralUnitsAtOnceReturnTheUnionOfTheirMembers()
    {
        using var db = NewContext();

        var results = await Repo(db).GetAsync([InScopeUnit, OtherUnit], null, CancellationToken.None);

        Assert.Equal([100L, 200L], results.Select(r => r.CustomerId).OrderBy(id => id).ToArray());
    }

    [Fact]
    public async Task NoTradeUnitsMeansNoScopeFilter_SoEveryProducersPlantingIsReturned()
    {
        // Unchanged behaviour, pinned because the scoping rewrite sits directly on this branch: an absent
        // trade-unit list is "not scoped", not "scoped to nothing". Every planting row comes back, including
        // the ones belonging to producers no trade-unit query would reach.
        using var db = NewContext();

        var results = await Repo(db).GetAsync(null, null, CancellationToken.None);

        Assert.Equal(5, results.Count);
        Assert.Equal([100L, 200L, 300L, 400L, 500L], results.Select(r => r.CustomerId).OrderBy(id => id).ToArray());
    }

    [Fact]
    public async Task ThePlantingYearFilterStillAppliesOnTopOfTheScope()
    {
        // Both an in-scope and an out-of-scope producer get a 2025 row, so this fails if the year filter
        // replaces the scope filter instead of narrowing it. With only one 2025 row in the fixture the
        // assertion would hold even with scoping completely broken.
        using var db = NewContext();
        db.PlantingIntentions.AddRange(
            new PlantingIntention { Id = 10, CustomerId = 100, PlantingYear = 2025, Crop = "YC", Acres = 450 },
            new PlantingIntention { Id = 11, CustomerId = 200, PlantingYear = 2025, Crop = "YSB", Acres = 275 });
        db.SaveChanges();

        var results = await Repo(db).GetAsync([InScopeUnit], 2025, CancellationToken.None);

        Assert.Single(results);
        Assert.Equal(2025, results[0].PlantingYear);
        Assert.Equal(100L, results[0].CustomerId);
    }

    [Fact]
    public async Task TheCustomerNameAndCodeAreComposedFromTheCustomerJoin()
    {
        // Those columns were dropped from the planting table, so they are only ever as good as the FK
        // join - and the scoping change moved which query supplies the customer rows.
        using var db = NewContext();

        var results = await Repo(db).GetAsync([InScopeUnit], null, CancellationToken.None);

        Assert.Equal("Member Farms", results[0].CustomerName);
        Assert.Equal("MEMBER", results[0].CustomerCode);
    }
}
