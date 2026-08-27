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
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
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

    /// <summary>
    /// Fails only CONTRACT documents; ticket documents succeed with an empty page.
    /// </summary>
    /// <remarks>
    /// The whole point of the test that uses this. With a client that fails everything, "the contract read
    /// failed while the ticket read succeeded" cannot be distinguished from "both failed" - which is how the
    /// original bug survived: the applied-ticket branch swallowed a contract failure, and any test that let
    /// the ticket read fail too would pass either way.
    /// </remarks>
    private sealed class ContractsOnlyFailureClient : ICtrmGraphQlClient
    {
        public bool IsConfigured => true;
        public int TicketCalls { get; private set; }
        public int ContractCalls { get; private set; }

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            // Contract documents ask for contracts; ticket documents ask for tickets.
            if (document.Contains("contracts(", StringComparison.Ordinal))
            {
                ContractCalls++;
                return Task.FromResult(new CtrmReadResult<T>
                {
                    Status = CtrmReadStatus.EgressBlocked,
                    Detail = "Timed out reaching the CTRM gateway."
                });
            }

            TicketCalls++;
            var response = new CtrmTicketsResponse
            {
                Tickets = new CtrmPage<CtrmTicketDto>
                {
                    TotalCount = 0,
                    PageInfo = new CtrmPageInfo { HasNextPage = false },
                    Items = []
                }
            };
            return Task.FromResult(new CtrmReadResult<T> { Status = CtrmReadStatus.Ok, HttpStatus = 200, Value = (T)(object)response });
        }
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

    /// <summary>Readers and contexts over one client, with a producer wired to a trade unit.</summary>
    private static (CtrmContractReader Contracts, CtrmTicketReader Tickets, ApplicationDbContext App, TicketRepository OdsTickets)
        Readers(ICtrmGraphQlClient client, IConfiguration config)
    {
        var ods = new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"outage-ods-{Guid.NewGuid()}").Options);
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"outage-app-{Guid.NewGuid()}").Options);

        app.Customers.Add(new Customer { Id = 1, ScoularId = Producer, Name = "Test Farm", IsActive = true });
        // The trade-unit link matters: without it the trade-unit and crop-year reads resolve to no producers
        // and return empty WITHOUT calling CTRM - correctly not a failure. Omitting it made two of these
        // tests pass through the wrong path entirely.
        app.CustomerTradeUnits.Add(new CustomerTradeUnit { Id = 1, CustomerId = 1, TradeUnit = "2190", IsActive = true });
        app.SaveChanges();

        return (
            new CtrmContractReader(client, config, new Mock<ILogger<CtrmContractReader>>().Object),
            new CtrmTicketReader(client, config, new Mock<ILogger<CtrmTicketReader>>().Object),
            app,
            new TicketRepository(ods, app, new Mock<ILogger<TicketRepository>>().Object));
    }

    private static (CtrmContractRepository Contracts, CtrmTicketRepository Tickets, CtrmProvenance Provenance) Sut()
    {
        var config = Config();
        var provenance = new CtrmProvenance();

        var (contractReader, ticketReader, app, odsTickets) = Readers(new UnreachableClient(), config);
        var odsForContracts = new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"outage-ods2-{Guid.NewGuid()}").Options);
        var odsContracts = new ContractRepository(odsForContracts, app, new Mock<ILogger<ContractRepository>>().Object);

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
        // The applied-tickets hole. The ticket read succeeds; the contract read that scopes its APPLIED rows
        // fails, so the endpoint would answer 200 with every applied ticket missing - "this producer has
        // delivered nothing against their contracts". Running the two concurrently made this combination
        // realistic rather than theoretical.
        var config = Config();
        var provenance = new CtrmProvenance();
        var client = new ContractsOnlyFailureClient();

        var (contractReader, ticketReader, app, odsTickets) = Readers(client, config);
        var tickets = new CtrmTicketRepository(ticketReader, contractReader, app, odsTickets, config, provenance,
            new Mock<ILogger<CtrmTicketRepository>>().Object);

        var rows = await tickets.GetByCustomerAsync(1, Producer, CancellationToken.None);

        // The ticket read genuinely ran and genuinely succeeded...
        Assert.True(client.TicketCalls > 0, "the ticket read never happened, so this proves nothing");
        Assert.True(client.ContractCalls > 0, "the contract read never happened, so this proves nothing");
        Assert.Empty(rows);

        // ...and the failure recorded is the CONTRACT one specifically.
        Assert.NotNull(provenance.Failure);
        Assert.Equal("contracts", provenance.Failure!.What);
        Assert.Equal(CtrmReadStatus.EgressBlocked, provenance.Failure.Status);

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, (await RunFilter(provenance)).HttpStatusCode);
    }
}
