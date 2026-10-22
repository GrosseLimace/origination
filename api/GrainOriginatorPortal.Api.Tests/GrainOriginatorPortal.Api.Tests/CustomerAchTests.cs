using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;
using GrainOriginatorPortal.Infrastructure.Sync;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace GrainOriginatorPortal.Api.Tests;

/// <summary>
/// Verifies the ACH-enabled rule: a producer is ACH-enabled iff its PaymentMethod code is 'H'.
/// Drives the blue "ACH Enabled" pill on the producer profile. Where the code is read depends on
/// CustomerSync:Source (plan E2): ODS base.Customer on ods (unchanged), dbo.Customer.PaymentMethod on ctrm.
/// </summary>
public class CustomerAchTests
{
    [Theory]
    [InlineData("H")]
    [InlineData("h")]
    [InlineData(" H ")]  // ODS CHAR-padding tolerated
    public void PaymentMethodH_IsAch(string paymentMethod)
    {
        Assert.True(CustomerRepository.IsAchPaymentMethod(paymentMethod));
    }

    [Theory]
    [InlineData("C")]
    [InlineData("HH")]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData(null)]
    public void OtherOrEmpty_IsNotAch(string? paymentMethod)
    {
        Assert.False(CustomerRepository.IsAchPaymentMethod(paymentMethod));
    }

    // -------------------------------------------------------------------------------------------------
    // Repository: which store the badge is read from

    private static CustomerRepository Build(string? source, OriginationDbContext ods, out ApplicationDbContext app)
    {
        app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"ach-app-{Guid.NewGuid()}").Options);
        app.Customers.AddRange(
            new Customer { Id = 1, ScoularId = "ACHH", Name = "A", IsActive = true, PaymentMethod = "H" },
            new Customer { Id = 2, ScoularId = "ACHPAD", Name = "B", IsActive = true, PaymentMethod = " h " },
            new Customer { Id = 3, ScoularId = "CHECK", Name = "C", IsActive = true, PaymentMethod = "C" },
            new Customer { Id = 4, ScoularId = "NONE", Name = "D", IsActive = true, PaymentMethod = null });
        app.SaveChanges();

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [CustomerSyncSources.ConfigKey] = source })
            .Build();

        // Strict: listing customers must not read contracts or tickets.
        return new CustomerRepository(ods, app,
            new Mock<ITicketRepository>(MockBehavior.Strict).Object,
            new Mock<IContractRepository>(MockBehavior.Strict).Object,
            new Mock<ILogger<CustomerRepository>>().Object,
            config);
    }

    private static OriginationDbContext Ods() =>
        new(new DbContextOptionsBuilder<OriginationDbContext>().UseInMemoryDatabase($"ach-ods-{Guid.NewGuid()}").Options);

    /// <summary>An ODS context that throws on any use, so a test fails if the code under test reads the ODS.</summary>
    private static OriginationDbContext DisposedOds()
    {
        var ods = Ods();
        ods.Dispose();
        return ods;
    }

    [Theory]
    [InlineData("ctrm")]
    [InlineData(" CTRM ")]
    public async Task CtrmSource_AchComesFromDboCustomerPaymentMethod_AndNeverTouchesTheOds(string source)
    {
        var sut = Build(source, DisposedOds(), out _);

        var customers = await sut.GetAsync(null, CancellationToken.None);

        Assert.Equal([1L, 2L], customers.Where(c => c.AchEnabled).Select(c => c.Id).OrderBy(id => id));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("ods")]
    [InlineData("something-else")]
    public async Task OdsSource_AchStillReadsBaseCustomer(string? source)
    {
        // The ODS read is still made: a context that throws on use proves it.
        var sut = Build(source, DisposedOds(), out _);

        await Assert.ThrowsAsync<ObjectDisposedException>(() => sut.GetAsync(null, CancellationToken.None));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("ods")]
    public async Task OdsSource_IgnoresTheDboCustomerPaymentMethodColumn(string? source)
    {
        // The in-memory ODS holds no base.Customer rows, so nobody is ACH even though dbo.Customer says 'H'.
        var sut = Build(source, Ods(), out _);

        var customers = await sut.GetAsync(null, CancellationToken.None);

        Assert.Equal(4, customers.Count);
        Assert.DoesNotContain(customers, c => c.AchEnabled);
    }

    [Fact]
    public async Task CtrmSource_PaymentMethodNullForEveryone_ShowsNoAch()
    {
        // Extended fields off on ctrm: the sync never fills PaymentMethod, so the badge simply does not show.
        var sut = Build("ctrm", DisposedOds(), out var app);
        foreach (var customer in app.Customers) customer.PaymentMethod = null;
        app.SaveChanges();

        var customers = await sut.GetAsync(null, CancellationToken.None);

        Assert.Equal(4, customers.Count);
        Assert.DoesNotContain(customers, c => c.AchEnabled);
    }
}
