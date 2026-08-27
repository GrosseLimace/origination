// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Routing;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Filters;
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// The whole outage path, end to end: CTRM is unreachable, so the API must answer 503 rather than 200.
/// </summary>
/// <remarks>
/// <para>The pieces are covered separately - the filter converts a recorded failure, the provenance
/// records one - but nothing pinned them TOGETHER, and the gap between them is exactly where the
/// applied-tickets bug lived (a failure logged but never recorded, so the filter saw nothing and the
/// endpoint answered 200 with half the data missing).</para>
///
/// <para>This is the automated half of the manual failure drill: point the client at an unroutable host
/// and confirm no screen shows an empty list. The manual half still matters for the rendering, but the
/// server contract it depends on is checked here on every build.</para>
/// </remarks>
public class CtrmOutageEndToEndTests
{
    private const string Producer = "TESTPRD";

    /// <summary>A client that cannot reach CTRM, like an unroutable GraphQlUri.</summary>
    private sealed class UnreachableClient : ICtrmGraphQlClient
    {
        public bool IsConfigured => true;

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken) =>
            Task.FromResult(new CtrmReadResult<T>
            {
                Status = CtrmReadStatus.EgressBlocked,
                Detail = "Timed out reaching the CTRM gateway."
            });
    }

    private static IConfiguration Config() =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:Source"] = "ctrm",
            ["Ctrm:LiveCacheSeconds"] = "0",
            ["Ctrm:TicketLookbackDays"] = "366",
            ["Ctrm:ServerTimeoutRetryDelaySeconds"] = "0",
            ["Ctrm:InteractiveServerTimeoutRetryDelaySeconds"] = "0",
            ["Ctrm:BackgroundMaxDeferSeconds"] = "0"
        }).Build();

    private static (CtrmContractRepository Contracts, CtrmTicketRepository Tickets, CtrmProvenance Provenance) Sut()
    {
        var config = Config();
        var provenance = new CtrmProvenance();
        var client = new UnreachableClient();

        var ods = new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"outage-ods-{Guid.NewGuid()}").Options);
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"outage-app-{Guid.NewGuid()}").Options);

        app.Customers.Add(new Customer { Id = 1, ScoularId = Producer, Name = "Test Farm", IsActive = true });
        // The trade-unit link matters: without it the trade-unit and crop-year reads resolve to no producers
        // and return empty WITHOUT calling CTRM - correctly not a failure. Omitting it made those two tests
        // pass through the wrong path entirely.
        app.CustomerTradeUnits.Add(new CustomerTradeUnit { Id = 1, CustomerId = 1, TradeUnit = "2190", IsActive = true });
        app.SaveChanges();

        var contractReader = new CtrmContractReader(client, config, new Mock<ILogger<CtrmContractReader>>().Object);
        var ticketReader = new CtrmTicketReader(client, config, new Mock<ILogger<CtrmTicketReader>>().Object);

        var odsContracts = new ContractRepository(ods, app, new Mock<ILogger<ContractRepository>>().Object);
        var odsTickets = new TicketRepository(ods, app, new Mock<ILogger<TicketRepository>>().Object);

        return (
            new CtrmContractRepository(contractReader, ticketReader, app, odsContracts, provenance,
                new Mock<ILogger<CtrmContractRepository>>().Object),
            new CtrmTicketRepository(ticketReader, contractReader, app, odsTickets, config, provenance,
                new Mock<ILogger<CtrmTicketRepository>>().Object),
            provenance);
    }

    private static async Task<InfrastructureException> RunFilter(CtrmProvenance provenance)
    {
        var services = new ServiceCollection();
        services.AddSingleton(provenance);
        var http = new DefaultHttpContext { RequestServices = services.BuildServiceProvider() };
        var actionContext = new ActionContext(http, new RouteData(), new ActionDescriptor());
        var executing = new ActionExecutingContext(actionContext, [], new Dictionary<string, object?>(), controller: null!);

        return await Assert.ThrowsAsync<InfrastructureException>(() =>
            new SurfaceCtrmFailuresAttribute().OnActionExecutionAsync(
                executing,
                () => Task.FromResult(new ActionExecutedContext(executing, [], controller: null!))));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AProducerContractReadOutageBecomesA503()
    {
        var (contracts, _, provenance) = Sut();

        var rows = await contracts.GetByCustomerAsync(1, Producer, CancellationToken.None);

        // The repository still answers empty - that is deliberate, no ODS fallback...
        Assert.Empty(rows);
        // ...but the failure is recorded, so the edge can tell it apart from a producer with no contracts.
        Assert.NotNull(provenance.Failure);

        var thrown = await RunFilter(provenance);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, thrown.HttpStatusCode);
        Assert.Equal("INFRASTRUCTURE_CTRM_UNAVAILABLE", thrown.ErrorCode);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AProducerTicketReadOutageBecomesA503()
    {
        var (_, tickets, provenance) = Sut();

        var rows = await tickets.GetByCustomerAsync(1, Producer, CancellationToken.None);

        Assert.Empty(rows);
        Assert.NotNull(provenance.Failure);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, (await RunFilter(provenance)).HttpStatusCode);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ATradeUnitContractReadOutageBecomesA503()
    {
        // The read behind Build-a-List. This is the one that rendered as "no producers found".
        var (contracts, _, provenance) = Sut();

        var rows = await contracts.GetAsync(["2190"], CancellationToken.None);

        Assert.Empty(rows);
        Assert.NotNull(provenance.Failure);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, (await RunFilter(provenance)).HttpStatusCode);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ACropYearReadOutageBecomesA503()
    {
        // Behind the planting-coverage prompts and the dashboard's Harvest & Contracts tab.
        var (contracts, _, provenance) = Sut();

        var rows = await contracts.GetByCropYearAsync(2026, ["2190"], CancellationToken.None);

        Assert.Empty(rows);
        Assert.NotNull(provenance.Failure);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, (await RunFilter(provenance)).HttpStatusCode);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AContractOutageIsReportedEvenWhenTheTicketReadItselfSucceeded()
    {
        // The applied-tickets hole: a ticket read can succeed while the contract read that scopes its
        // applied rows fails, and the endpoint would answer 200 with every applied ticket missing.
        var (_, tickets, provenance) = Sut();

        await tickets.GetByCustomerAsync(1, Producer, CancellationToken.None);

        Assert.NotNull(provenance.Failure);
        Assert.Contains(provenance.Failure!.What, new[] { "contracts", "tickets" });
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, (await RunFilter(provenance)).HttpStatusCode);
    }
}
