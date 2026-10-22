// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Direct coverage of <see cref="CustomerSyncRepository"/> against InMemory databases: the three
/// bulk loads the nightly sync diffs, the deferred-save write surface (adds are not visible until
/// <c>SaveChangesAsync</c>), and the empty-id short-circuit in front of the master read.
/// </summary>
/// <remarks>
/// Deliberately NOT tested here: <c>LoadCurrentCustomerMasterAsync</c> with ids. It is a
/// <c>SqlQueryRaw</c> over <c>base.vw_CurrentCustomers</c> behind <c>SetCommandTimeout</c>, neither of
/// which the InMemory provider can run; only its empty-input guard is pinned.
/// </remarks>
public class CustomerSyncRepositoryTests
{
    /// <summary>The real context maps the ODS trade-unit view keyless (it never writes), which the
    /// InMemory provider can't seed. This subclass adds a key purely so a test can arrange rows.</summary>
    private sealed class SeedableOds(DbContextOptions<OriginationDbContext> options) : OriginationDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            modelBuilder.Entity<CustomerTradeUnitView>(e =>
            {
                e.ToTable("CustomerTradeUnits");
                e.Property<int>("RowId").ValueGeneratedOnAdd();
                e.HasKey("RowId");
            });
        }
    }

    private static (CustomerSyncRepository Sut, OriginationDbContext Ods, ApplicationDbContext App) Build()
    {
        var ods = new SeedableOds(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"sync-ods-{Guid.NewGuid()}").Options);
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"sync-app-{Guid.NewGuid()}").Options);
        return (new CustomerSyncRepository(ods, app), ods, app);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task LoadOdsTradeUnitRowsAsync_ReturnsEveryViewRow_IncludingDuplicatesPerTradeUnit()
    {
        var (sut, ods, _) = Build();
        ods.CustomerTradeUnits.AddRange(
            new CustomerTradeUnitView { CustomerId = 1, ScoularId = "A", TradeUnit = "4056" },
            new CustomerTradeUnitView { CustomerId = 1, ScoularId = "A", TradeUnit = "2190" },
            new CustomerTradeUnitView { CustomerId = 2, ScoularId = "B", TradeUnit = null });
        await ods.SaveChangesAsync();

        var rows = await sut.LoadOdsTradeUnitRowsAsync(CancellationToken.None);

        Assert.Equal(3, rows.Count);                                            // the sync does its own grouping
        Assert.Equal(new[] { 1L, 1L, 2L }, rows.Select(r => r.CustomerId).OrderBy(id => id));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task LoadAppCustomersAndTradeUnits_ReturnActiveAndInactiveAlike()
    {
        var (sut, _, app) = Build();
        app.Customers.AddRange(
            new Customer { Id = 1, Name = "Live", IsActive = true },
            new Customer { Id = 2, Name = "Deactivated", IsActive = false });
        app.CustomerTradeUnits.AddRange(
            new CustomerTradeUnit { Id = 1, CustomerId = 1, TradeUnit = "4056", IsActive = true },
            new CustomerTradeUnit { Id = 2, CustomerId = 2, TradeUnit = "4056", IsActive = false });
        await app.SaveChangesAsync();

        var customers = await sut.LoadAppCustomersAsync(CancellationToken.None);
        var tradeUnits = await sut.LoadAppTradeUnitsAsync(CancellationToken.None);

        Assert.Equal(2, customers.Count);                                       // the sync needs the inactive rows to bring them back
        Assert.Equal(2, tradeUnits.Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AddCustomerAndTradeUnit_AreDeferredUntilSaveChanges()
    {
        var (sut, _, app) = Build();

        sut.AddCustomer(new Customer { Id = 10, Name = "New Farm", ScoularId = "NEW", IsActive = true });
        sut.AddTradeUnit(new CustomerTradeUnit { Id = 10, CustomerId = 10, TradeUnit = "4056", IsActive = true, CreatedBy = "sync" });

        Assert.Equal(0, await app.Customers.AsNoTracking().CountAsync());       // nothing persisted yet
        await sut.SaveChangesAsync(CancellationToken.None);

        Assert.Equal("New Farm", (await app.Customers.AsNoTracking().SingleAsync()).Name);
        Assert.Equal(10, (await app.CustomerTradeUnits.AsNoTracking().SingleAsync()).CustomerId);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task LoadCurrentCustomerMasterAsync_NoIds_ReturnsEmptyWithoutTouchingTheView()
    {
        var (sut, _, _) = Build();

        var rows = await sut.LoadCurrentCustomerMasterAsync([], CancellationToken.None);

        Assert.Empty(rows);
    }
}
