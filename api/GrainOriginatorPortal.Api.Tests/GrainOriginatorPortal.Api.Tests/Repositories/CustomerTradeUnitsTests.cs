// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Modules.Customers;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Entities;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// The customer trade units Platform asks the Customers module for: a customer's, for the per-request access check,
/// and every customer's, for the trade-unit catalog's fallback. Both read dbo.CustomerTradeUnit (the sync's output,
/// manual assignments included) instead of the live ODS view.
/// </summary>
public class CustomerTradeUnitsTests
{
    private static (CustomerTradeUnits Sut, ApplicationDbContext App) Build()
    {
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"ctu-app-{Guid.NewGuid()}").Options);
        return (new CustomerTradeUnits(app), app);
    }

    private static void SeedCustomerSeven(ApplicationDbContext app)
    {
        app.CustomerTradeUnits.AddRange(
            new CustomerTradeUnit { CustomerId = 7, TradeUnit = "1085 ", IsActive = true },
            new CustomerTradeUnit { CustomerId = 7, TradeUnit = "1085", IsActive = true, IsManual = true },
            new CustomerTradeUnit { CustomerId = 7, TradeUnit = "2200", IsActive = true, IsManual = true },
            new CustomerTradeUnit { CustomerId = 7, TradeUnit = "3300", IsActive = false, UserDeactivated = true },
            new CustomerTradeUnit { CustomerId = 8, TradeUnit = "4400", IsActive = true });
        app.SaveChanges();
    }

    [Fact]
    public async Task GetActiveCodesAsync_ReturnsDistinctTrimmedActiveCodes_IncludingManual_ExcludingInactive()
    {
        var (sut, app) = Build();
        SeedCustomerSeven(app);

        var codes = await sut.GetActiveCodesAsync(7, CancellationToken.None);

        Assert.Equal(["1085", "2200"], codes.OrderBy(c => c, StringComparer.Ordinal).ToList());
    }

    [Fact]
    public async Task GetActiveCodesAsync_DropsBlankCodes()
    {
        var (sut, app) = Build();
        app.CustomerTradeUnits.AddRange(
            new CustomerTradeUnit { CustomerId = 1, TradeUnit = "4056", IsActive = true },
            new CustomerTradeUnit { CustomerId = 1, TradeUnit = "  ", IsActive = true });
        await app.SaveChangesAsync();

        Assert.Equal(["4056"], await sut.GetActiveCodesAsync(1, CancellationToken.None));
    }

    [Fact]
    public async Task GetActiveCodesAsync_UnknownCustomer_ReturnsEmpty()
    {
        var (sut, app) = Build();
        SeedCustomerSeven(app);

        Assert.Empty(await sut.GetActiveCodesAsync(999, CancellationToken.None));
    }

    [Fact]
    public async Task GetAllActiveCodesAsync_IsEveryActiveCodeOnce_Ordered()
    {
        // Kept off padded codes: SQL Server ignores trailing spaces when comparing, the in-memory provider does not.
        var (sut, app) = Build();
        app.CustomerTradeUnits.AddRange(
            new CustomerTradeUnit { CustomerId = 1, TradeUnit = "4056", IsActive = true },
            new CustomerTradeUnit { CustomerId = 2, TradeUnit = "4056", IsActive = true },
            new CustomerTradeUnit { CustomerId = 2, TradeUnit = "2190", IsActive = true },
            new CustomerTradeUnit { CustomerId = 3, TradeUnit = "3811", IsActive = false });
        await app.SaveChangesAsync();

        Assert.Equal(["2190", "4056"], await sut.GetAllActiveCodesAsync(CancellationToken.None));
    }
}
