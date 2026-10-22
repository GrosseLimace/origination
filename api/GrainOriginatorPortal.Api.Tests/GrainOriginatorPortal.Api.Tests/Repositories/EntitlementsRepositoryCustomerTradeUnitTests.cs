// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// The per-request access check reads a customer's trade units from dbo.CustomerTradeUnit (the sync's
/// output, manual assignments included) instead of the live ODS view.
/// </summary>
public class EntitlementsRepositoryCustomerTradeUnitTests
{
    private static EntitlementsRepository Build()
    {
        var entitlements = new TradeUnitPreferencesDbContext(new DbContextOptionsBuilder<TradeUnitPreferencesDbContext>()
            .UseInMemoryDatabase($"ent-tup-{Guid.NewGuid()}").Options);
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"ent-app-{Guid.NewGuid()}").Options);

        app.CustomerTradeUnits.AddRange(
            new CustomerTradeUnit { CustomerId = 7, TradeUnit = "1085 ", IsActive = true },
            new CustomerTradeUnit { CustomerId = 7, TradeUnit = "1085", IsActive = true, IsManual = true },
            new CustomerTradeUnit { CustomerId = 7, TradeUnit = "2200", IsActive = true, IsManual = true },
            new CustomerTradeUnit { CustomerId = 7, TradeUnit = "3300", IsActive = false, UserDeactivated = true },
            new CustomerTradeUnit { CustomerId = 8, TradeUnit = "4400", IsActive = true });
        app.SaveChanges();

        return new EntitlementsRepository(entitlements, app);
    }

    [Fact]
    public async Task GetCustomerTradeUnitCodesAsync_ReturnsDistinctTrimmedActiveCodes_IncludingManual_ExcludingInactive()
    {
        var sut = Build();

        var codes = await sut.GetCustomerTradeUnitCodesAsync(7, CancellationToken.None);

        Assert.Equal(["1085", "2200"], codes.OrderBy(c => c, StringComparer.Ordinal).ToList());
    }

    [Fact]
    public async Task GetCustomerTradeUnitCodesAsync_UnknownCustomer_ReturnsEmpty()
    {
        var sut = Build();

        var codes = await sut.GetCustomerTradeUnitCodesAsync(999, CancellationToken.None);

        Assert.Empty(codes);
    }
}
