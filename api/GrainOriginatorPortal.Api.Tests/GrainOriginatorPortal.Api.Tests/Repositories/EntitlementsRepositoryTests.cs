// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Direct coverage of <see cref="EntitlementsRepository"/> against InMemory databases: per-user and
/// per-trade-unit reads over the preferences view, the blank-code exclusion on the full read, the
/// distinct code projections, and the active-roster filter used for mention validation.
/// </summary>
/// <remarks>
/// Case-insensitive matching on UserId is deliberately not asserted: InMemory compares ordinally
/// while Azure SQL does not. Only the comparer on the returned set is pinned.
/// </remarks>
public class EntitlementsRepositoryTests
{
    /// <summary>The real contexts map these views keyless (they never write), which the InMemory
    /// provider can't seed. These subclasses add keys purely so a test can arrange rows; the queries
    /// under test are inherited unchanged.</summary>
    private sealed class SeedableEntitlements(DbContextOptions<TradeUnitPreferencesDbContext> options)
        : TradeUnitPreferencesDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            modelBuilder.Entity<UserTradeUnitPreference>(e =>
            {
                e.ToTable("UserTradeUnitPreferences");
                e.Property<int>("RowId").ValueGeneratedOnAdd();
                e.HasKey("RowId");
            });
            modelBuilder.Entity<TradeUnitPreferencesUser>(e =>
            {
                e.ToTable("Users");
                e.HasKey(x => x.UserId);
            });
        }
    }

    // The producer -> trade-unit read comes from the app's own dbo.CustomerTradeUnit (customers off the
    // ODS), a real keyed table, so it needs no seeding subclass.
    private static (EntitlementsRepository Sut, TradeUnitPreferencesDbContext Ent, ApplicationDbContext App) Build()
    {
        var ent = new SeedableEntitlements(new DbContextOptionsBuilder<TradeUnitPreferencesDbContext>()
            .UseInMemoryDatabase($"ent-{Guid.NewGuid()}").Options);
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"ent-app-{Guid.NewGuid()}").Options);
        return (new EntitlementsRepository(ent, app), ent, app);
    }

    private static CustomerTradeUnit Link(long customerId, string tradeUnit, bool isActive = true) => new()
    {
        CustomerId = customerId, TradeUnit = tradeUnit, IsActive = isActive, CreatedAt = DateTime.UtcNow, CreatedBy = "test"
    };

    private static UserTradeUnitPreference Pref(string user, string tradeUnit, string? group = null) => new()
    {
        UserId = user, DisplayName = user, TradeUnitCode = tradeUnit, GroupName = group
    };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByUserAsync_ReturnsOnlyThatUsersRows()
    {
        var (sut, ent, _) = Build();
        ent.UserTradeUnitPreferences.AddRange(Pref("cegr", "4056"), Pref("cegr", "2190"), Pref("hcol", "4056"));
        await ent.SaveChangesAsync();

        var rows = await sut.GetByUserAsync("cegr", CancellationToken.None);

        Assert.Equal(new[] { "2190", "4056" }, rows.Select(r => r.TradeUnitCode).OrderBy(c => c));
        Assert.Empty(await sut.GetByUserAsync("nobody", CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetAllAsync_DropsRowsWithoutATradeUnitCode()
    {
        var (sut, ent, _) = Build();
        ent.UserTradeUnitPreferences.AddRange(Pref("cegr", "4056"), Pref("ghost", ""));
        await ent.SaveChangesAsync();

        var rows = await sut.GetAllAsync(CancellationToken.None);

        Assert.Equal(new[] { "cegr" }, rows.Select(r => r.UserId));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetUsersByTradeUnitsAsync_EmptyRequestShortCircuits_OtherwiseFiltersByCode()
    {
        var (sut, ent, _) = Build();
        ent.UserTradeUnitPreferences.AddRange(Pref("cegr", "4056"), Pref("hcol", "2190"), Pref("mark", "9999"));
        await ent.SaveChangesAsync();

        Assert.Empty(await sut.GetUsersByTradeUnitsAsync([], CancellationToken.None));

        var rows = await sut.GetUsersByTradeUnitsAsync(["4056", "2190"], CancellationToken.None);

        Assert.Equal(new[] { "cegr", "hcol" }, rows.Select(r => r.UserId).OrderBy(u => u));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetTradeUnitCodesForUserAsync_IsDistinctAcrossGroupAssignments()
    {
        var (sut, ent, _) = Build();
        ent.UserTradeUnitPreferences.AddRange(
            Pref("cegr", "4056", group: "Grain East"),
            Pref("cegr", "4056", group: "Grain West"),   // same code through a second group
            Pref("cegr", "2190"));
        await ent.SaveChangesAsync();

        var codes = await sut.GetTradeUnitCodesForUserAsync("cegr", CancellationToken.None);

        Assert.Equal(new[] { "2190", "4056" }, codes.OrderBy(c => c));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetCustomerTradeUnitCodesAsync_DistinctNonBlankActiveCodesForThatCustomer()
    {
        var (sut, _, app) = Build();
        app.CustomerTradeUnits.AddRange(
            Link(1, "4056"),
            Link(1, "4056 "),                          // trailing space: the same unit, counted once
            Link(1, "  "),                             // blank: dropped
            Link(1, "2190"),
            Link(1, "3811", isActive: false),          // removed membership: not a current unit
            Link(2, "9999"));
        await app.SaveChangesAsync();

        var codes = await sut.GetCustomerTradeUnitCodesAsync(1, CancellationToken.None);

        Assert.Equal(new[] { "2190", "4056" }, codes.OrderBy(c => c));
        Assert.Empty(await sut.GetCustomerTradeUnitCodesAsync(3, CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetActiveUserIdsAsync_ReturnsOnlyActiveMembersOfTheRequestedSet()
    {
        var (sut, ent, _) = Build();
        ent.Users.AddRange(
            new TradeUnitPreferencesUser { UserId = "cegr", DisplayName = "Caden", IsActive = true },
            new TradeUnitPreferencesUser { UserId = "left", DisplayName = "Gone", IsActive = false },
            new TradeUnitPreferencesUser { UserId = "hcol", DisplayName = "Holly", IsActive = true });
        await ent.SaveChangesAsync();

        var active = await sut.GetActiveUserIdsAsync(["cegr", "left", "unknown"], CancellationToken.None);

        Assert.Equal(new[] { "cegr" }, active);
        Assert.Contains("CEGR", active);                               // the returned set is case-insensitive for the caller
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetActiveUserIdsAsync_EmptyRequest_ReturnsEmptyCaseInsensitiveSet()
    {
        var (sut, _, _) = Build();

        var active = await sut.GetActiveUserIdsAsync([], CancellationToken.None);

        Assert.Empty(active);
        Assert.Equal(StringComparer.OrdinalIgnoreCase, active.Comparer);
    }
}
